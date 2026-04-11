import express from "express";
import { readFileSync } from "fs";
import { createServer } from "http";
import { join } from "path";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3001;
const MIN_PLAYERS = 3;
const CARDS_PER_PLAYER = 4;
const CARD_TYPES = {
  CRIMINAL: "Criminal",
  FIRST_DISCOVERER: "First Discoverer",
  DETECTIVE: "Detective",
  MAN: "Man"
};
const DEFAULT_NAMES_FILE = join(process.cwd(), "server", "default-player-names.txt");
const DEFAULT_PLAYER_NAMES = loadDefaultPlayerNames();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const players = new Map();
const clients = new Map();

let phase = "lobby";
let currentPlayerId = null;
let turnOrder = [];
let discardPile = [];
let logEntries = [];
let winner = null;
let firstDiscovererId = null;
let roundNumber = 0;
let turnsTakenInRound = 0;
let pendingDetectiveGuess = null;
let wrongGuessNotice = null;
let wrongGuessTimeout = null;

function loadDefaultPlayerNames() {
  try {
    return readFileSync(DEFAULT_NAMES_FILE, "utf8")
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean);
  } catch (error) {
    console.warn("Could not load default player names:", error.message);
    return [];
  }
}

function getDisplayName(playerId) {
  const player = players.get(playerId);
  return player?.name || playerId;
}

function getNextDefaultName(playerId) {
  const usedNames = new Set(
    [...players.values()]
      .filter((player) => player.id !== playerId)
      .map((player) => player.name.toLowerCase())
  );

  for (const name of DEFAULT_PLAYER_NAMES) {
    if (!usedNames.has(name.toLowerCase())) {
      return name;
    }
  }

  return `Player ${playerId}`;
}

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    players: players.size,
    phase
  });
});

function addLogEntry(message) {
  logEntries = [...logEntries, message].slice(-16);
}

function shuffle(items) {
  const nextItems = [...items];

  for (let index = nextItems.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [nextItems[index], nextItems[swapIndex]] = [
      nextItems[swapIndex],
      nextItems[index]
    ];
  }

  return nextItems;
}

function buildDeck(playerCount) {
  const totalCards = playerCount * CARDS_PER_PLAYER;
  const deck = [
    { id: crypto.randomUUID(), type: CARD_TYPES.CRIMINAL },
    { id: crypto.randomUUID(), type: CARD_TYPES.FIRST_DISCOVERER },
    { id: crypto.randomUUID(), type: CARD_TYPES.DETECTIVE }
  ];

  while (deck.length < totalCards) {
    deck.push({ id: crypto.randomUUID(), type: CARD_TYPES.MAN });
  }

  return shuffle(deck);
}

function getPlayableParticipants() {
  return turnOrder
    .map((playerId) => players.get(playerId))
    .filter(Boolean)
    .filter((player) => !player.spectator);
}

function canStartGame() {
  return phase !== "playing" && players.size >= MIN_PLAYERS;
}

function getOrderedPlayers() {
  if (turnOrder.length > 0) {
    const orderedInGame = turnOrder
      .map((playerId) => players.get(playerId))
      .filter(Boolean);
    const others = [...players.values()].filter(
      (player) => !turnOrder.includes(player.id)
    );

    return [...orderedInGame, ...others];
  }

  return [...players.values()];
}

function broadcastState() {
  for (const [socket, playerId] of clients.entries()) {
    if (socket.readyState !== 1) {
      continue;
    }

    const self = players.get(playerId);
    const gamePlayers = getOrderedPlayers().map((player) => ({
      id: player.id,
      name: player.name,
      handCount: player.hand.length,
      isCurrentTurn: player.id === currentPlayerId,
      spectator: player.spectator
    }));

    socket.send(
      JSON.stringify({
        type: "state",
        phase,
        canStart: canStartGame(),
        currentPlayerId,
        players: gamePlayers,
        yourName: self?.name ?? "",
        yourHand: self?.hand ?? [],
        discardPile,
        logEntries,
        winner,
        wrongGuessNotice,
        pendingDetectiveGuess: pendingDetectiveGuess
          ? {
              detectivePlayerId: pendingDetectiveGuess.detectivePlayerId,
              detectiveName: getDisplayName(
                pendingDetectiveGuess.detectivePlayerId
              ),
              selectedTargetPlayerId:
                pendingDetectiveGuess.selectedTargetPlayerId ?? "",
              waitingForGuess:
                pendingDetectiveGuess.detectivePlayerId === playerId
            }
          : null,
        roundNumber,
        firstDiscovererId,
        yourTurn: phase === "playing" && currentPlayerId === playerId,
        minimumPlayers: MIN_PLAYERS,
        mustPlayFirstDiscoverer:
          phase === "playing" &&
          roundNumber === 1 &&
          currentPlayerId === playerId &&
          firstDiscovererId === playerId &&
          Boolean(
            self?.hand.some(
              (card) => card.type === CARD_TYPES.FIRST_DISCOVERER
            )
          )
      })
    );
  }
}

function sendError(socket, message) {
  if (socket.readyState !== 1) {
    return;
  }

  socket.send(JSON.stringify({ type: "error", message }));
}

function advanceTurn() {
  const activePlayers = getPlayableParticipants();

  if (activePlayers.length < MIN_PLAYERS) {
    phase = "finished";
    currentPlayerId = null;
    winner = {
      reason: "not_enough_players",
      message: "The game ended because fewer than 3 players remained connected.",
      winners: []
    };
    addLogEntry(winner.message);
    return;
  }

  if (turnOrder.length === 0 || currentPlayerId === null) {
    currentPlayerId = activePlayers[0]?.id ?? null;
    return;
  }

  const currentIndex = turnOrder.indexOf(currentPlayerId);

  for (let offset = 1; offset <= turnOrder.length; offset += 1) {
    const nextPlayerId = turnOrder[(currentIndex + offset) % turnOrder.length];
    const nextPlayer = players.get(nextPlayerId);

    if (nextPlayer && !nextPlayer.spectator) {
      currentPlayerId = nextPlayerId;
      return;
    }
  }

  currentPlayerId = activePlayers[0]?.id ?? null;
}

function finishWithCriminalPlay(playerId) {
  clearTransientStateOnFinish();
  phase = "finished";
  winner = {
    reason: "criminal_played",
    message: `${getDisplayName(playerId)} played the Criminal card as their last card and wins.`,
    winners: [playerId],
    criminalPlayerId: playerId
  };
  currentPlayerId = null;
  addLogEntry(winner.message);
}

function finishWithDetectiveGuess(detectiveId, targetPlayerId) {
  clearTransientStateOnFinish();
  phase = "finished";
  winner = {
    reason: "detective_guess",
    message: `${getDisplayName(detectiveId)} identified ${getDisplayName(targetPlayerId)} as the Criminal.`,
    winners: turnOrder.filter((playerId) => playerId !== targetPlayerId),
    criminalPlayerId: targetPlayerId
  };
  currentPlayerId = null;
  addLogEntry(winner.message);
}

function initializeGame() {
  const deck = buildDeck(players.size);
  const ids = [...players.keys()];

  phase = "playing";
  currentPlayerId = null;
  discardPile = [];
  logEntries = [];
  winner = null;
  firstDiscovererId = null;
  roundNumber = 1;
  turnsTakenInRound = 0;
  pendingDetectiveGuess = null;
  wrongGuessNotice = null;

  if (wrongGuessTimeout) {
    clearTimeout(wrongGuessTimeout);
    wrongGuessTimeout = null;
  }

  for (const player of players.values()) {
    player.spectator = false;
    player.hand = [];
  }

  for (let cardIndex = 0; cardIndex < CARDS_PER_PLAYER; cardIndex += 1) {
    for (const playerId of ids) {
      const player = players.get(playerId);
      player.hand.push(deck.shift());
    }
  }

  for (const player of players.values()) {
    if (
      player.hand.some((card) => card.type === CARD_TYPES.FIRST_DISCOVERER)
    ) {
      firstDiscovererId = player.id;
      break;
    }
  }

  const firstIndex = ids.indexOf(firstDiscovererId);
  turnOrder = [...ids.slice(firstIndex), ...ids.slice(0, firstIndex)];
  currentPlayerId = firstDiscovererId;

  addLogEntry(`A new game started with ${players.size} players.`);
  addLogEntry(
    `${getDisplayName(firstDiscovererId)} has the First Discoverer card and takes the first turn.`
  );
}

function resetToLobby() {
  clearTransientStateOnFinish();
  phase = "lobby";
  currentPlayerId = null;
  turnOrder = [];
  discardPile = [];
  winner = null;
  firstDiscovererId = null;
  roundNumber = 0;
  turnsTakenInRound = 0;

  for (const player of players.values()) {
    player.hand = [];
    player.spectator = false;
  }

  addLogEntry("Returned to the lobby for the next game.");
}

function handleSetName(socket, playerId, payload) {
  const player = players.get(playerId);

  if (!player) {
    sendError(socket, "Player not found.");
    return;
  }

  if (phase === "playing") {
    sendError(socket, "You can only change your name before the game begins.");
    return;
  }

  const nextName = String(payload.name ?? "").trim().slice(0, 24);

  if (!nextName) {
    sendError(socket, "Please enter a name.");
    return;
  }

  const duplicateName = [...players.values()].some(
    (otherPlayer) =>
      otherPlayer.id !== playerId &&
      otherPlayer.name.toLowerCase() === nextName.toLowerCase()
  );

  if (duplicateName) {
    sendError(socket, "That name is already taken. Please choose a different one.");
    return;
  }

  const previousName = player.name;
  player.name = nextName;
  addLogEntry(
    previousName === nextName
      ? `${nextName} refreshed their lobby name.`
      : `${previousName} is now known as ${nextName}.`
  );
  broadcastState();
}

function handlePlayCard(socket, playerId, payload) {
  const player = players.get(playerId);

  if (phase !== "playing") {
    sendError(socket, "The game is not currently running.");
    return;
  }

  if (!player || player.spectator) {
    sendError(socket, "You are not an active player in this round.");
    return;
  }

  if (currentPlayerId !== playerId) {
    sendError(socket, "It is not your turn yet.");
    return;
  }

  if (pendingDetectiveGuess) {
    sendError(socket, "A Detective guess is still pending.");
    return;
  }

  if (wrongGuessNotice) {
    sendError(socket, "Please wait for the Detective result to finish displaying.");
    return;
  }

  const card = player.hand.find((handCard) => handCard.id === payload.cardId);

  if (!card) {
    sendError(socket, "That card is not in your hand.");
    return;
  }

  const mustPlayFirstDiscoverer =
    roundNumber === 1 &&
    playerId === firstDiscovererId &&
    player.hand.some((handCard) => handCard.type === CARD_TYPES.FIRST_DISCOVERER);

  if (
    mustPlayFirstDiscoverer &&
    card.type !== CARD_TYPES.FIRST_DISCOVERER
  ) {
    sendError(
      socket,
      "You must play the First Discoverer card on the opening turn."
    );
    return;
  }

  if (
    card.type === CARD_TYPES.CRIMINAL &&
    player.hand.length !== 1
  ) {
    sendError(
      socket,
      "The Criminal card can only be played when it is your last remaining card."
    );
    return;
  }

  player.hand = player.hand.filter((handCard) => handCard.id !== payload.cardId);
  discardPile = [
    ...discardPile,
    {
      cardType: card.type,
      playedBy: getDisplayName(playerId)
    }
  ];
  addLogEntry(`${getDisplayName(playerId)} played ${card.type}.`);

  if (card.type === CARD_TYPES.DETECTIVE) {
    pendingDetectiveGuess = {
      detectivePlayerId: playerId,
      selectedTargetPlayerId: ""
    };
    addLogEntry(
      `${getDisplayName(playerId)} revealed Detective. Waiting for the accusation.`
    );
    broadcastState();
    return;
  }

  if (card.type === CARD_TYPES.CRIMINAL) {
    finishWithCriminalPlay(playerId);
    broadcastState();
    return;
  }

  turnsTakenInRound += 1;

  if (turnsTakenInRound >= getPlayableParticipants().length) {
    roundNumber += 1;
    turnsTakenInRound = 0;
    addLogEntry(`Round ${roundNumber} begins.`);
  }

  advanceTurn();
  broadcastState();
}

function handleDetectiveGuess(socket, playerId, payload) {
  if (!pendingDetectiveGuess) {
    sendError(socket, "There is no Detective guess pending right now.");
    return;
  }

  if (pendingDetectiveGuess.detectivePlayerId !== playerId) {
    sendError(socket, "Only the active Detective can make this guess.");
    return;
  }

  const targetPlayerId = payload.targetPlayerId;

  if (!targetPlayerId || targetPlayerId === playerId) {
    sendError(socket, "Choose another player to investigate.");
    return;
  }

  const target = players.get(targetPlayerId);

  if (!target || target.spectator) {
    sendError(socket, "That player is not available to investigate.");
    return;
  }

  const targetHasCriminal = target.hand.some(
    (handCard) => handCard.type === CARD_TYPES.CRIMINAL
  );

  pendingDetectiveGuess = null;

  if (targetHasCriminal) {
    finishWithDetectiveGuess(playerId, target.id);
    broadcastState();
    return;
  }

  addLogEntry(
    `${getDisplayName(playerId)} investigated ${getDisplayName(target.id)}, but the guess was incorrect.`
  );
  wrongGuessNotice = {
    message: `A Detective guessed ${getDisplayName(target.id)} as a Criminal but it was incorrect.`
  };
  broadcastState();

  if (wrongGuessTimeout) {
    clearTimeout(wrongGuessTimeout);
  }

  wrongGuessTimeout = setTimeout(() => {
    wrongGuessNotice = null;
    wrongGuessTimeout = null;

    turnsTakenInRound += 1;

    if (turnsTakenInRound >= getPlayableParticipants().length) {
      roundNumber += 1;
      turnsTakenInRound = 0;
      addLogEntry(`Round ${roundNumber} begins.`);
    }

    advanceTurn();
    broadcastState();
  }, 3000);
}

function handleDetectiveSelection(socket, playerId, payload) {
  if (!pendingDetectiveGuess) {
    sendError(socket, "There is no Detective guess pending right now.");
    return;
  }

  if (pendingDetectiveGuess.detectivePlayerId !== playerId) {
    sendError(socket, "Only the active Detective can change this selection.");
    return;
  }

  const targetPlayerId = String(payload.targetPlayerId ?? "");

  if (!targetPlayerId) {
    pendingDetectiveGuess.selectedTargetPlayerId = "";
    broadcastState();
    return;
  }

  if (targetPlayerId === playerId) {
    sendError(socket, "Choose another player to investigate.");
    return;
  }

  const target = players.get(targetPlayerId);

  if (!target || target.spectator) {
    sendError(socket, "That player is not available to investigate.");
    return;
  }

  pendingDetectiveGuess.selectedTargetPlayerId = targetPlayerId;
  broadcastState();
}

function clearTransientStateOnFinish() {
  pendingDetectiveGuess = null;
  wrongGuessNotice = null;

  if (wrongGuessTimeout) {
    clearTimeout(wrongGuessTimeout);
    wrongGuessTimeout = null;
  }
}

wss.on("connection", (socket) => {
  const playerId = crypto.randomUUID().slice(0, 8);
  const spectator = phase === "playing";

  players.set(playerId, {
    id: playerId,
    name: getNextDefaultName(playerId),
    hand: [],
    spectator
  });
  clients.set(socket, playerId);

  socket.send(JSON.stringify({ type: "welcome", playerId }));

  if (spectator) {
    addLogEntry(
      `${getDisplayName(playerId)} connected and will join the next game because a round is already in progress.`
    );
  } else {
    addLogEntry(`${getDisplayName(playerId)} joined the table.`);
  }

  broadcastState();

  socket.on("message", (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage.toString());

      if (message.type === "start_game") {
        if (!canStartGame()) {
          sendError(
            socket,
            `You need at least ${MIN_PLAYERS} players and no active round to start a game.`
          );
          return;
        }

        initializeGame();
        broadcastState();
        return;
      }

      if (message.type === "set_name") {
        handleSetName(socket, playerId, message);
        return;
      }

      if (message.type === "play_card") {
        handlePlayCard(socket, playerId, message);
        return;
      }

      if (message.type === "detective_select") {
        handleDetectiveSelection(socket, playerId, message);
        return;
      }

      if (message.type === "detective_guess") {
        handleDetectiveGuess(socket, playerId, message);
        return;
      }

      if (message.type === "return_to_lobby") {
        if (phase !== "finished") {
          sendError(socket, "You can only return to the lobby after the game ends.");
          return;
        }

        resetToLobby();
        broadcastState();
        return;
      }
    } catch (error) {
      console.error("Invalid socket message", error);
      sendError(socket, "That action could not be processed.");
    }
  });

  socket.on("close", () => {
    clients.delete(socket);
    players.delete(playerId);

    if (turnOrder.includes(playerId)) {
      turnOrder = turnOrder.filter((id) => id !== playerId);

      if (currentPlayerId === playerId && phase === "playing") {
        if (
          pendingDetectiveGuess &&
          pendingDetectiveGuess.detectivePlayerId === playerId
        ) {
          pendingDetectiveGuess = null;
          addLogEntry(
            `${getDisplayName(playerId)} left before making a Detective guess.`
          );
        }

        currentPlayerId = turnOrder[0] ?? null;
        advanceTurn();
      }
    }

    if (firstDiscovererId === playerId) {
      firstDiscovererId = turnOrder[0] ?? null;
    }

    addLogEntry(`${getDisplayName(playerId)} left the table.`);
    broadcastState();
  });
});

server.listen(PORT, () => {
  console.log(`Multiplayer server listening on http://localhost:${PORT}`);
});
