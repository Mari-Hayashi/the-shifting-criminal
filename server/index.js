import express from "express";
import { existsSync, readFileSync } from "fs";
import { createServer } from "http";
import { join } from "path";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3001;
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 7;
const MIN_INITIAL_CARD_COUNT = 4;
const RECONNECT_GRACE_PERIOD_MS = 3 * 60 * 1000;
const ROOM_ID_PATTERN = /^[A-Z]{4}$/;
const CARD_TYPES = {
  CRIMINAL: "Criminal",
  FIRST_DISCOVERER: "First Discoverer",
  DETECTIVE: "Detective",
  ALIBI: "Alibi",
  BOY: "Boy",
  DEAL: "Deal",
  EYEWITNESS: "Eyewitness",
  INTRIGUE: "Intrigue",
  MEDIA_MANIPULATION: "Media Manipulation",
  RUMOR: "Rumor",
  MAN: "Man"
};
const CARD_SET_BREAKDOWN = {
  [CARD_TYPES.CRIMINAL]: 1,
  [CARD_TYPES.FIRST_DISCOVERER]: 1,
  [CARD_TYPES.BOY]: 1,
  [CARD_TYPES.MAN]: 2,
  [CARD_TYPES.INTRIGUE]: 2,
  [CARD_TYPES.EYEWITNESS]: 3,
  [CARD_TYPES.MEDIA_MANIPULATION]: 3,
  [CARD_TYPES.DETECTIVE]: 4,
  [CARD_TYPES.RUMOR]: 4,
  [CARD_TYPES.ALIBI]: 5,
  [CARD_TYPES.DEAL]: 5
};
const DEFAULT_NAMES_FILE = join(process.cwd(), "server", "default-player-names.txt");
const DIST_DIR = join(process.cwd(), "dist");
const DIST_INDEX_FILE = join(DIST_DIR, "index.html");
const DEFAULT_PLAYER_NAMES = loadDefaultPlayerNames();
const TOTAL_CARD_COUNT = Object.values(CARD_SET_BREAKDOWN).reduce(
  (sum, count) => sum + count,
  0
);
const DEFAULT_ROOM_OPTIONS = {
  initialCardCount: MIN_INITIAL_CARD_COUNT,
  useRandomSetOfCards: false
};

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const rooms = new Map();
const clients = new Map();

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

function createRoom(roomId) {
  return {
    id: roomId,
    defaultNameOrder: shuffle(DEFAULT_PLAYER_NAMES),
    options: { ...DEFAULT_ROOM_OPTIONS },
    players: new Map(),
    phase: "lobby",
    currentPlayerId: null,
    turnOrder: [],
    discardPile: [],
    logEntries: [],
    winner: null,
    gameError: null,
    firstDiscovererId: null,
    roundNumber: 0,
    turnsTakenInRound: 0,
    pendingDetectiveGuess: null,
    pendingDeal: null,
    pendingBoy: null,
    pendingEyewitness: null,
    pendingMediaManipulation: null,
    dealNotice: null,
    dealNoticeTimeout: null,
    wrongGuessNotice: null,
    wrongGuessTimeout: null,
    rumorNotice: null,
    rumorNoticeTimeout: null,
    mediaManipulationNotice: null,
    mediaManipulationNoticeTimeout: null,
    intriguePlayerIds: [],
    roundHasCriminalCard: true
  };
}

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, createRoom(roomId));
  }

  return rooms.get(roomId);
}

function getDisplayName(room, playerId) {
  const player = room.players.get(playerId);
  return player?.name || playerId;
}

function getConnectedPlayers(room) {
  return [...room.players.values()].filter((player) => player.connected);
}

function getOrderedPlayers(room) {
  if (room.turnOrder.length > 0) {
    const orderedInGame = room.turnOrder
      .map((playerId) => room.players.get(playerId))
      .filter(Boolean);
    const others = [...room.players.values()].filter(
      (player) => !room.turnOrder.includes(player.id)
    );

    return [...orderedInGame, ...others];
  }

  return [...room.players.values()];
}

function getPlayableParticipants(room) {
  return room.turnOrder
    .map((playerId) => room.players.get(playerId))
    .filter(Boolean)
    .filter((player) => !player.spectator);
}

function getDisconnectedPlayers(room) {
  return getPlayableParticipants(room).filter((player) => !player.connected);
}

function getExchangeEligiblePlayers(room, excludingPlayerId) {
  return getPlayableParticipants(room).filter(
    (player) => player.id !== excludingPlayerId && player.hand.length > 0
  );
}

function getNextTurnEligiblePlayerIds(room) {
  return getPlayableParticipants(room)
    .filter((player) => player.hand.length > 0)
    .map((player) => player.id);
}

function getMaxInitialCardCount(playerCount) {
  if (playerCount <= 0) {
    return TOTAL_CARD_COUNT;
  }

  return Math.floor(TOTAL_CARD_COUNT / playerCount);
}

function validateRoomOptions(room, nextOptions) {
  const connectedPlayerCount = Math.max(getConnectedPlayers(room).length, 1);
  const initialCardCount = Number(nextOptions.initialCardCount);
  const maxInitialCardCount = getMaxInitialCardCount(connectedPlayerCount);

  if (!Number.isInteger(initialCardCount)) {
    return {
      message:
        "Initial card count must be a whole number.",
      messageKey: "initialCardCountWholeNumber"
    };
  }

  if (initialCardCount < MIN_INITIAL_CARD_COUNT) {
    return {
      message: `Initial card count must be at least ${MIN_INITIAL_CARD_COUNT}.`,
      messageKey: "initialCardCountTooSmall",
      params: { min: MIN_INITIAL_CARD_COUNT }
    };
  }

  if (initialCardCount > maxInitialCardCount) {
    return {
      message: `Initial card count cannot be greater than ${maxInitialCardCount} for the current player count.`,
      messageKey: "initialCardCountTooLarge",
      params: { max: maxInitialCardCount }
    };
  }

  return null;
}

function canStartGame(room) {
  const optionsError = validateRoomOptions(room, room.options);

  return (
    room.phase !== "playing" &&
    getConnectedPlayers(room).length >= MIN_PLAYERS &&
    room.players.size <= MAX_PLAYERS &&
    !optionsError
  );
}

function addLogEntry(room, message) {
  room.logEntries = [...room.logEntries, message].slice(-16);
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

function createCard(type) {
  return { id: crypto.randomUUID(), type };
}

function getMustUseCardTypes(playerCount) {
  if (playerCount === 3) {
    return [
      CARD_TYPES.CRIMINAL,
      CARD_TYPES.FIRST_DISCOVERER,
      CARD_TYPES.DETECTIVE,
      CARD_TYPES.ALIBI
    ];
  }

  if (playerCount === 4) {
    return [
      CARD_TYPES.CRIMINAL,
      CARD_TYPES.FIRST_DISCOVERER,
      CARD_TYPES.DETECTIVE,
      CARD_TYPES.ALIBI,
      CARD_TYPES.INTRIGUE
    ];
  }

  if (playerCount === 5) {
    return [
      CARD_TYPES.CRIMINAL,
      CARD_TYPES.FIRST_DISCOVERER,
      CARD_TYPES.DETECTIVE,
      CARD_TYPES.ALIBI,
      CARD_TYPES.ALIBI,
      CARD_TYPES.INTRIGUE
    ];
  }

  if (playerCount === 6) {
    return [
      CARD_TYPES.CRIMINAL,
      CARD_TYPES.FIRST_DISCOVERER,
      CARD_TYPES.DETECTIVE,
      CARD_TYPES.DETECTIVE,
      CARD_TYPES.ALIBI,
      CARD_TYPES.ALIBI,
      CARD_TYPES.INTRIGUE,
      CARD_TYPES.INTRIGUE
    ];
  }

  return [
    CARD_TYPES.CRIMINAL,
    CARD_TYPES.FIRST_DISCOVERER,
    CARD_TYPES.DETECTIVE,
    CARD_TYPES.DETECTIVE,
    CARD_TYPES.ALIBI,
    CARD_TYPES.ALIBI,
    CARD_TYPES.ALIBI,
    CARD_TYPES.INTRIGUE,
    CARD_TYPES.INTRIGUE
  ];
}

function buildDeck(playerCount, initialCardCount, useRandomSetOfCards) {
  const totalCards = playerCount * initialCardCount;
  const remainingCounts = { ...CARD_SET_BREAKDOWN };
  const deck = [];

  if (!useRandomSetOfCards) {
    const mustUseCardTypes = getMustUseCardTypes(playerCount);

    for (const type of mustUseCardTypes) {
      remainingCounts[type] -= 1;
      deck.push(createCard(type));
    }
  }

  const remainingPool = [];

  for (const [type, count] of Object.entries(remainingCounts)) {
    for (let cardIndex = 0; cardIndex < count; cardIndex += 1) {
      remainingPool.push(type);
    }
  }

  const shuffledRemainingPool = shuffle(remainingPool);

  while (deck.length < totalCards && shuffledRemainingPool.length > 0) {
    deck.push(createCard(shuffledRemainingPool.shift()));
  }

  return shuffle(deck);
}

function clearPlayerDisconnectTimer(player) {
  if (player?.disconnectTimeout) {
    clearTimeout(player.disconnectTimeout);
    player.disconnectTimeout = null;
  }
}

function getDisconnectionMessage(disconnectedPlayers) {
  if (disconnectedPlayers.length === 0) {
    return "";
  }

  if (disconnectedPlayers.length === 1) {
    return `${disconnectedPlayers[0].name} is disconnected. Waiting for ${disconnectedPlayers[0].name} to rejoin...`;
  }

  const names = disconnectedPlayers.map((player) => player.name);
  const lastName = names.pop();
  return `${names.join(", ")} and ${lastName} are disconnected. Waiting for them to rejoin...`;
}

function getDisconnectionNoticeData(disconnectedPlayers) {
  if (disconnectedPlayers.length === 0) {
    return null;
  }

  if (disconnectedPlayers.length === 1) {
    return {
      messageKey: "disconnectedWaitingSingle",
      params: { playerName: disconnectedPlayers[0].name }
    };
  }

  const names = disconnectedPlayers.map((player) => player.name);
  const lastName = names.at(-1);
  const otherNames = names.slice(0, -1);

  return {
    messageKey: "disconnectedWaitingMultiple",
    params: {
      otherNames: otherNames.join(", "),
      lastName
    }
  };
}

function getNextDefaultName(room, playerId) {
  const usedNames = new Set(
    [...room.players.values()]
      .filter((player) => player.id !== playerId)
      .map((player) => player.name.toLowerCase())
  );

  const candidateNames =
    room.defaultNameOrder?.length > 0
      ? room.defaultNameOrder
      : shuffle(DEFAULT_PLAYER_NAMES);

  room.defaultNameOrder = candidateNames;

  for (const name of candidateNames) {
    if (!usedNames.has(name.toLowerCase())) {
      return name;
    }
  }

  return `Player ${playerId}`;
}

function maybeDeleteRoom(room) {
  if (room.players.size === 0) {
    clearTransientStateOnFinish(room);
    rooms.delete(room.id);
  }
}

function broadcastState(room) {
  const disconnectedPlayers = getDisconnectedPlayers(room);
  const disconnectedNoticeData = getDisconnectionNoticeData(disconnectedPlayers);

  for (const [socket, session] of clients.entries()) {
    if (session.roomId !== room.id || socket.readyState !== 1) {
      continue;
    }

    const self = room.players.get(session.playerId);
    const gamePlayers = getOrderedPlayers(room).map((player) => ({
      id: player.id,
      name: player.name,
      handCount: player.hand.length,
      isCurrentTurn: player.id === room.currentPlayerId,
      spectator: player.spectator,
      connected: player.connected,
      isIntrigue: room.intriguePlayerIds.includes(player.id)
    }));

    socket.send(
      JSON.stringify({
        type: "state",
        roomId: room.id,
        phase: room.phase,
        canStart: canStartGame(room),
        currentPlayerId: room.currentPlayerId,
        players: gamePlayers,
        totalCardCount: TOTAL_CARD_COUNT,
        options: room.options,
        yourName: self?.name ?? "",
        yourHand: self?.hand ?? [],
        discardPile: room.discardPile,
        logEntries: room.logEntries,
        winner: room.winner,
        gameError: room.gameError,
        disconnectedNotice:
          room.phase === "playing" && disconnectedPlayers.length > 0
            ? {
                message: getDisconnectionMessage(disconnectedPlayers),
                messageKey: disconnectedNoticeData?.messageKey ?? null,
                params: disconnectedNoticeData?.params ?? {},
                players: disconnectedPlayers.map((player) => ({
                  id: player.id,
                  name: player.name
                }))
              }
            : null,
        dealNotice: room.dealNotice
          ? {
              id: room.dealNotice.id,
              actorName: room.dealNotice.actorName,
              targetPlayerName: room.dealNotice.targetPlayerName,
              givenCardType:
                room.dealNotice.resultsByPlayerId[session.playerId]?.givenCardType ??
                null,
              receivedCardType:
                room.dealNotice.resultsByPlayerId[session.playerId]?.receivedCardType ??
                null,
              nextPlayerName:
                room.dealNotice.resultsByPlayerId[session.playerId]?.nextPlayerName ??
                "",
              previousPlayerName:
                room.dealNotice.resultsByPlayerId[session.playerId]?.previousPlayerName ??
                ""
            }
          : null,
        wrongGuessNotice: room.wrongGuessNotice,
        mediaManipulationNotice: room.mediaManipulationNotice
          ? {
              id: room.mediaManipulationNotice.id,
              actorName: room.mediaManipulationNotice.actorName,
              givenCardType:
                room.mediaManipulationNotice.resultsByPlayerId[session.playerId]
                  ?.givenCardType ?? null,
              receivedCardType:
                room.mediaManipulationNotice.resultsByPlayerId[session.playerId]
                  ?.receivedCardType ?? null,
              nextPlayerName:
                room.mediaManipulationNotice.resultsByPlayerId[session.playerId]
                  ?.nextPlayerName ?? "",
              previousPlayerName:
                room.mediaManipulationNotice.resultsByPlayerId[session.playerId]
                  ?.previousPlayerName ?? ""
            }
          : null,
        rumorNotice: room.rumorNotice
          ? {
              id: room.rumorNotice.id,
              actorName: room.rumorNotice.actorName,
              givenCardType:
                room.rumorNotice.resultsByPlayerId[session.playerId]?.givenCardType ??
                null,
              receivedCardType:
                room.rumorNotice.resultsByPlayerId[session.playerId]
                  ?.receivedCardType ?? null,
              nextPlayerName:
                room.rumorNotice.resultsByPlayerId[session.playerId]?.nextPlayerName ??
                "",
              previousPlayerName:
                room.rumorNotice.resultsByPlayerId[session.playerId]
                  ?.previousPlayerName ?? ""
            }
          : null,
        pendingDeal: room.pendingDeal
          ? {
              stage: room.pendingDeal.stage,
              dealPlayerId: room.pendingDeal.dealPlayerId,
              dealPlayerName: getDisplayName(room, room.pendingDeal.dealPlayerId),
              targetPlayerId: room.pendingDeal.targetPlayerId,
              targetPlayerName: room.pendingDeal.targetPlayerId
                ? getDisplayName(room, room.pendingDeal.targetPlayerId)
                : "",
              yourRole:
                room.pendingDeal.dealPlayerId === session.playerId
                  ? "deal_player"
                  : room.pendingDeal.targetPlayerId === session.playerId
                    ? "target_player"
                    : "observer",
              waitingForTarget: room.pendingDeal.stage === "target_selection",
              waitingForExchange: room.pendingDeal.stage === "card_selection",
              yourSubmitted:
                room.pendingDeal.stage === "card_selection" &&
                Boolean(room.pendingDeal.submittedBy[session.playerId])
            }
          : null,
        pendingBoy: room.pendingBoy
          ? {
              boyPlayerId: room.pendingBoy.boyPlayerId,
              boyPlayerName: getDisplayName(room, room.pendingBoy.boyPlayerId),
              yourRole:
                room.pendingBoy.boyPlayerId === session.playerId
                  ? "boy_player"
                  : "observer",
              showingReveal: true,
              hasCriminal: room.pendingBoy.hasCriminal,
              criminalPlayerName:
                room.pendingBoy.boyPlayerId === session.playerId
                  ? room.pendingBoy.criminalPlayerName
                  : "",
              criminalPlayerId:
                room.pendingBoy.boyPlayerId === session.playerId
                  ? room.pendingBoy.criminalPlayerId
                  : null
            }
          : null,
        pendingEyewitness: room.pendingEyewitness
          ? {
              stage: room.pendingEyewitness.stage,
              eyewitnessPlayerId: room.pendingEyewitness.eyewitnessPlayerId,
              eyewitnessPlayerName: getDisplayName(
                room,
                room.pendingEyewitness.eyewitnessPlayerId
              ),
              targetPlayerId: room.pendingEyewitness.targetPlayerId ?? "",
              targetPlayerName: room.pendingEyewitness.targetPlayerId
                ? getDisplayName(room, room.pendingEyewitness.targetPlayerId)
                : "",
              yourRole:
                room.pendingEyewitness.eyewitnessPlayerId === session.playerId
                  ? "eyewitness_player"
                  : "observer",
              waitingForTarget:
                room.pendingEyewitness.stage === "target_selection",
              showingReveal: room.pendingEyewitness.stage === "reveal",
              targetHand:
                room.pendingEyewitness.stage === "reveal" &&
                room.pendingEyewitness.eyewitnessPlayerId === session.playerId
                  ? room.pendingEyewitness.targetHandSnapshot
                  : []
            }
          : null,
        pendingMediaManipulation: room.pendingMediaManipulation
          ? {
              actorPlayerId: room.pendingMediaManipulation.actorPlayerId,
              actorName: getDisplayName(
                room,
                room.pendingMediaManipulation.actorPlayerId
              ),
              yourSubmitted: Boolean(
                room.pendingMediaManipulation.submittedBy[session.playerId]
              ),
              canChooseCard: Boolean(
                self &&
                  !self.spectator &&
                  self.connected &&
                  self.hand.length > 0 &&
                  room.phase === "playing"
              )
            }
          : null,
        pendingDetectiveGuess: room.pendingDetectiveGuess
          ? {
              detectivePlayerId: room.pendingDetectiveGuess.detectivePlayerId,
              detectiveName: getDisplayName(
                room,
                room.pendingDetectiveGuess.detectivePlayerId
              ),
              selectedTargetPlayerId:
                room.pendingDetectiveGuess.selectedTargetPlayerId ?? "",
              waitingForGuess:
                room.pendingDetectiveGuess.detectivePlayerId === session.playerId
            }
          : null,
        roundNumber: room.roundNumber,
        firstDiscovererId: room.firstDiscovererId,
        yourTurn:
          room.phase === "playing" && room.currentPlayerId === session.playerId,
        minimumPlayers: MIN_PLAYERS,
        mustPlayFirstDiscoverer:
          room.phase === "playing" &&
          room.roundNumber === 1 &&
          room.currentPlayerId === session.playerId &&
          room.firstDiscovererId === session.playerId &&
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

function sendErrorKey(socket, messageKey, params = {}, fallbackMessage = "") {
  if (socket.readyState !== 1) {
    return;
  }

  socket.send(
    JSON.stringify({
      type: "error",
      message: fallbackMessage,
      messageKey,
      params
    })
  );
}

function ensureNoDisconnectedPlayers(room, socket) {
  if (room.phase === "playing" && getDisconnectedPlayers(room).length > 0) {
    sendError(socket, "The game is paused while disconnected players rejoin.");
    return false;
  }

  return true;
}

function terminateGameDueToDisconnection(room, playerName) {
  clearTransientStateOnFinish(room);
  room.phase = "finished";
  room.currentPlayerId = null;
  room.winner = null;
  room.gameError = {
    message: `The game has been terminated because ${playerName} did not rejoin within 3 minutes.`,
    messageKey: "gameTerminatedDisconnection",
    params: { playerName }
  };
  addLogEntry(room, room.gameError.message);
  broadcastState(room);
}

function advanceTurn(room) {
  const activePlayers = getPlayableParticipants(room);
  const eligiblePlayerIds = getNextTurnEligiblePlayerIds(room);

  if (activePlayers.length < MIN_PLAYERS) {
    room.phase = "finished";
    room.currentPlayerId = null;
    room.winner = {
      reason: "not_enough_players",
      message: "The game ended because fewer than 3 players remained connected.",
      winners: []
    };
    addLogEntry(room, room.winner.message);
    return;
  }

  if (eligiblePlayerIds.length === 0) {
    room.phase = "finished";
    room.currentPlayerId = null;
    room.winner = room.roundHasCriminalCard
      ? {
          reason: "no_cards_remaining",
          message: "The round ended because no player had any cards left to play.",
          winners: []
        }
      : {
          reason: "no_criminal_in_round",
          message:
            "No Criminal card was used this round, so players on the Criminal side lose.",
          winners: room.turnOrder.filter(
            (playerId) => !room.intriguePlayerIds.includes(playerId)
          )
        };
    addLogEntry(room, room.winner.message);
    return;
  }

  if (room.turnOrder.length === 0 || room.currentPlayerId === null) {
    room.currentPlayerId = eligiblePlayerIds[0] ?? null;
    return;
  }

  const currentIndex = room.turnOrder.indexOf(room.currentPlayerId);

  for (let offset = 1; offset <= room.turnOrder.length; offset += 1) {
    const nextPlayerId =
      room.turnOrder[(currentIndex + offset) % room.turnOrder.length];
    const nextPlayer = room.players.get(nextPlayerId);

    if (
      nextPlayer &&
      !nextPlayer.spectator &&
      nextPlayer.hand.length > 0
    ) {
      room.currentPlayerId = nextPlayerId;
      return;
    }
  }

  room.currentPlayerId = eligiblePlayerIds[0] ?? null;
}

function clearTransientStateOnFinish(room) {
  room.pendingDetectiveGuess = null;
  room.pendingDeal = null;
  room.pendingBoy = null;
  room.pendingEyewitness = null;
  room.pendingMediaManipulation = null;
  room.dealNotice = null;
  room.wrongGuessNotice = null;
  room.mediaManipulationNotice = null;
  room.rumorNotice = null;

  if (room.wrongGuessTimeout) {
    clearTimeout(room.wrongGuessTimeout);
    room.wrongGuessTimeout = null;
  }

  if (room.dealNoticeTimeout) {
    clearTimeout(room.dealNoticeTimeout);
    room.dealNoticeTimeout = null;
  }

  if (room.mediaManipulationNoticeTimeout) {
    clearTimeout(room.mediaManipulationNoticeTimeout);
    room.mediaManipulationNoticeTimeout = null;
  }

  if (room.rumorNoticeTimeout) {
    clearTimeout(room.rumorNoticeTimeout);
    room.rumorNoticeTimeout = null;
  }
}

function finishWithCriminalPlay(room, playerId) {
  clearTransientStateOnFinish(room);
  room.phase = "finished";
  room.winner = {
    reason: "criminal_played",
    message: `${getDisplayName(room, playerId)} played the Criminal card as their last card and wins.`,
    messageKey: "criminalPlayedWin",
    params: { playerName: getDisplayName(room, playerId) },
    winners: [...new Set([playerId, ...room.intriguePlayerIds])],
    criminalPlayerId: playerId
  };
  room.currentPlayerId = null;
  addLogEntry(room, room.winner.message);
}

function finishWithDetectiveGuess(room, detectiveId, targetPlayerId) {
  clearTransientStateOnFinish(room);
  room.phase = "finished";
  room.winner = {
    reason: "detective_guess",
    message: `${getDisplayName(room, detectiveId)} identified ${getDisplayName(room, targetPlayerId)} as the Criminal.`,
    messageKey: "detectiveIdentifiedCriminal",
    params: {
      detectiveName: getDisplayName(room, detectiveId),
      targetName: getDisplayName(room, targetPlayerId)
    },
    winners: room.turnOrder.filter(
      (playerId) =>
        playerId !== targetPlayerId && !room.intriguePlayerIds.includes(playerId)
    ),
    criminalPlayerId: targetPlayerId
  };
  room.currentPlayerId = null;
  addLogEntry(room, room.winner.message);
}

function initializeGame(room) {
  const activePlayers = getConnectedPlayers(room).filter(
    (player) => !player.spectator
  );
  const deck = buildDeck(
    activePlayers.length,
    room.options.initialCardCount,
    room.options.useRandomSetOfCards
  );
  const shuffledPlayerIds = shuffle(activePlayers.map((player) => player.id));

  room.phase = "playing";
  room.currentPlayerId = null;
  room.discardPile = [];
  room.logEntries = [];
  room.winner = null;
  room.gameError = null;
  room.firstDiscovererId = null;
  room.roundNumber = 1;
  room.turnsTakenInRound = 0;
  room.intriguePlayerIds = [];
  room.roundHasCriminalCard = deck.some(
    (card) => card.type === CARD_TYPES.CRIMINAL
  );
  clearTransientStateOnFinish(room);

  for (const player of room.players.values()) {
    player.spectator = !player.connected;
    player.hand = [];
    player.openingHandTypes = [];
    player.disconnectedAt = null;
    clearPlayerDisconnectTimer(player);
  }

  for (
    let cardIndex = 0;
    cardIndex < room.options.initialCardCount;
    cardIndex += 1
  ) {
    for (const playerId of shuffledPlayerIds) {
      const player = room.players.get(playerId);
      player.hand.push(deck.shift());
    }
  }

  for (const player of room.players.values()) {
    player.openingHandTypes = player.hand.map((card) => card.type);

    if (
      player.hand.some((card) => card.type === CARD_TYPES.FIRST_DISCOVERER)
    ) {
      room.firstDiscovererId = player.id;
      break;
    }
  }

  const firstIndex = shuffledPlayerIds.indexOf(room.firstDiscovererId);
  room.turnOrder = [
    ...shuffledPlayerIds.slice(firstIndex),
    ...shuffledPlayerIds.slice(0, firstIndex)
  ];
  room.currentPlayerId = room.firstDiscovererId;

  addLogEntry(room, `A new game started with ${activePlayers.length} players.`);
  addLogEntry(
    room,
    `${getDisplayName(room, room.firstDiscovererId)} has the First Discoverer card and takes the first turn.`
  );
}

function resetToLobby(room) {
  clearTransientStateOnFinish(room);
  room.phase = "lobby";
  room.currentPlayerId = null;
  room.turnOrder = [];
  room.discardPile = [];
  room.winner = null;
  room.gameError = null;
  room.firstDiscovererId = null;
  room.roundNumber = 0;
  room.turnsTakenInRound = 0;
  room.intriguePlayerIds = [];
  room.roundHasCriminalCard = true;

  for (const [id, player] of room.players.entries()) {
    if (!player.connected) {
      clearPlayerDisconnectTimer(player);
      room.players.delete(id);
    }
  }

  for (const player of room.players.values()) {
    player.hand = [];
    player.openingHandTypes = [];
    player.spectator = false;
    player.connected = true;
    player.disconnectedAt = null;
    clearPlayerDisconnectTimer(player);
  }

  addLogEntry(room, "Returned to the lobby for the next game.");
  maybeDeleteRoom(room);
}

function completeMediaManipulationExchange(room) {
  const actorPlayerId = room.pendingMediaManipulation.actorPlayerId;
  const mediaPlayers = getPlayableParticipants(room);
  const cardToPassByPlayerId = {};
  const resultsByPlayerId = {};

  for (const mediaPlayer of mediaPlayers) {
    const selectedCardId = room.pendingMediaManipulation.selectedCards[mediaPlayer.id];

    if (!selectedCardId) {
      cardToPassByPlayerId[mediaPlayer.id] = null;
      continue;
    }

    cardToPassByPlayerId[mediaPlayer.id] =
      mediaPlayer.hand.find((card) => card.id === selectedCardId) ?? null;
  }

  for (let index = 0; index < mediaPlayers.length; index += 1) {
    const mediaPlayer = mediaPlayers[index];
    const nextPlayer = mediaPlayers[(index + 1) % mediaPlayers.length];
    const previousPlayer =
      mediaPlayers[(index - 1 + mediaPlayers.length) % mediaPlayers.length];
    const givenCard = cardToPassByPlayerId[mediaPlayer.id];
    const receivedCard = cardToPassByPlayerId[previousPlayer.id];

    if (givenCard) {
      mediaPlayer.hand = mediaPlayer.hand.filter(
        (card) => card.id !== givenCard.id
      );
    }

    resultsByPlayerId[mediaPlayer.id] = {
      givenCardType: givenCard?.type ?? null,
      receivedCardType: receivedCard?.type ?? null,
      nextPlayerName: getDisplayName(room, nextPlayer.id),
      previousPlayerName: getDisplayName(room, previousPlayer.id)
    };
  }

  for (let index = 0; index < mediaPlayers.length; index += 1) {
    const mediaPlayer = mediaPlayers[index];
    const previousPlayer =
      mediaPlayers[(index - 1 + mediaPlayers.length) % mediaPlayers.length];
    const receivedCard = cardToPassByPlayerId[previousPlayer.id];

    if (receivedCard) {
      mediaPlayer.hand.push(receivedCard);
    }
  }

  room.pendingMediaManipulation = null;
  room.mediaManipulationNotice = {
    id: crypto.randomUUID(),
    actorName: getDisplayName(room, actorPlayerId),
    resultsByPlayerId
  };
  broadcastState(room);

  if (room.mediaManipulationNoticeTimeout) {
    clearTimeout(room.mediaManipulationNoticeTimeout);
  }

  room.mediaManipulationNoticeTimeout = setTimeout(() => {
    room.mediaManipulationNotice = null;
    room.mediaManipulationNoticeTimeout = null;

    room.turnsTakenInRound += 1;

    if (room.turnsTakenInRound >= getPlayableParticipants(room).length) {
      room.roundNumber += 1;
      room.turnsTakenInRound = 0;
      addLogEntry(room, `Round ${room.roundNumber} begins.`);
    }

    advanceTurn(room);
    broadcastState(room);
  }, 4000);
}

function completeEyewitnessReveal(room) {
  if (!room.pendingEyewitness) {
    return;
  }

  room.pendingEyewitness = null;
  room.turnsTakenInRound += 1;

  if (room.turnsTakenInRound >= getPlayableParticipants(room).length) {
    room.roundNumber += 1;
    room.turnsTakenInRound = 0;
    addLogEntry(room, `Round ${room.roundNumber} begins.`);
  }

  advanceTurn(room);
  broadcastState(room);
}

function completeBoyReveal(room) {
  if (!room.pendingBoy) {
    return;
  }

  room.pendingBoy = null;
  room.turnsTakenInRound += 1;

  if (room.turnsTakenInRound >= getPlayableParticipants(room).length) {
    room.roundNumber += 1;
    room.turnsTakenInRound = 0;
    addLogEntry(room, `Round ${room.roundNumber} begins.`);
  }

  advanceTurn(room);
  broadcastState(room);
}

function completeDealExchange(room) {
  const dealPlayer = room.players.get(room.pendingDeal.dealPlayerId);
  const targetPlayer = room.players.get(room.pendingDeal.targetPlayerId);
  const dealPlayerCardId =
    room.pendingDeal.selectedCards[room.pendingDeal.dealPlayerId];
  const targetPlayerCardId =
    room.pendingDeal.selectedCards[room.pendingDeal.targetPlayerId];

  if (!dealPlayer || !targetPlayer) {
    room.pendingDeal = null;
    broadcastState(room);
    return;
  }

  const dealPlayerCard = dealPlayer.hand.find((card) => card.id === dealPlayerCardId);
  const targetPlayerCard = targetPlayer.hand.find((card) => card.id === targetPlayerCardId);

  if (!dealPlayerCard || !targetPlayerCard) {
    room.pendingDeal = null;
    broadcastState(room);
    return;
  }

  const dealPlayerName = getDisplayName(room, dealPlayer.id);
  const targetPlayerName = getDisplayName(room, targetPlayer.id);

  dealPlayer.hand = dealPlayer.hand.map((card) =>
    card.id === dealPlayerCardId ? targetPlayerCard : card
  );
  targetPlayer.hand = targetPlayer.hand.map((card) =>
    card.id === targetPlayerCardId ? dealPlayerCard : card
  );

  addLogEntry(
    room,
    `${dealPlayerName} exchanged one card with ${targetPlayerName}.`
  );

  room.pendingDeal = null;
  room.dealNotice = {
    id: crypto.randomUUID(),
    actorName: dealPlayerName,
    targetPlayerName,
    resultsByPlayerId: {
      [dealPlayer.id]: {
        givenCardType: dealPlayerCard.type,
        receivedCardType: targetPlayerCard.type,
        nextPlayerName: targetPlayerName,
        previousPlayerName: targetPlayerName
      },
      [targetPlayer.id]: {
        givenCardType: targetPlayerCard.type,
        receivedCardType: dealPlayerCard.type,
        nextPlayerName: dealPlayerName,
        previousPlayerName: dealPlayerName
      }
    }
  };
  broadcastState(room);

  if (room.dealNoticeTimeout) {
    clearTimeout(room.dealNoticeTimeout);
  }

  room.dealNoticeTimeout = setTimeout(() => {
    room.dealNotice = null;
    room.dealNoticeTimeout = null;
    room.turnsTakenInRound += 1;

    if (room.turnsTakenInRound >= getPlayableParticipants(room).length) {
      room.roundNumber += 1;
      room.turnsTakenInRound = 0;
      addLogEntry(room, `Round ${room.roundNumber} begins.`);
    }

    advanceTurn(room);
    broadcastState(room);
  }, 3000);
}

function handleSetName(room, socket, playerId, payload) {
  const player = room.players.get(playerId);

  if (!player) {
    sendError(socket, "Player not found.");
    return;
  }

  const nextName = String(payload.name ?? "").trim().slice(0, 24);

  if (!nextName) {
    sendError(socket, "Please enter a name.");
    return;
  }

  if (room.phase === "playing") {
    if (!player.spectator) {
      sendError(socket, "Names cannot be changed during a game.");
      return;
    }

    const reconnectTarget = getDisconnectedPlayers(room).find(
      (otherPlayer) => otherPlayer.name.toLowerCase() === nextName.toLowerCase()
    );

    if (!reconnectTarget) {
      sendError(
        socket,
        "To rejoin during a game, enter the exact same name as a disconnected player."
      );
      return;
    }

    clearPlayerDisconnectTimer(reconnectTarget);
    reconnectTarget.connected = true;
    reconnectTarget.disconnectedAt = null;
    reconnectTarget.spectator = false;
    room.players.delete(playerId);
    clients.set(socket, { roomId: room.id, playerId: reconnectTarget.id });

    socket.send(
      JSON.stringify({
        type: "welcome",
        playerId: reconnectTarget.id,
        roomId: room.id
      })
    );
    addLogEntry(room, `${reconnectTarget.name} rejoined the game.`);
    broadcastState(room);
    return;
  }

  const duplicateName = [...room.players.values()].some(
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
    room,
    previousName === nextName
      ? `${nextName} refreshed their lobby name.`
      : `${previousName} is now known as ${nextName}.`
  );
  broadcastState(room);
}

function handleSetOptions(room, socket, playerId, payload) {
  const player = room.players.get(playerId);

  if (!player) {
    sendError(socket, "Player not found.");
    return;
  }

  if (room.phase === "playing") {
    sendError(socket, "Options can only be changed in the lobby.");
    return;
  }

  const nextOptions = {
    initialCardCount: Number(payload.initialCardCount),
    useRandomSetOfCards: Boolean(payload.useRandomSetOfCards)
  };
  const validationError = validateRoomOptions(room, nextOptions);

  if (validationError) {
    sendErrorKey(
      socket,
      validationError.messageKey,
      validationError.params ?? {},
      validationError.message
    );
    return;
  }

  room.options = nextOptions;
  addLogEntry(
    room,
    `${getDisplayName(room, playerId)} updated the room options.`
  );
  broadcastState(room);
}

function handlePlayCard(room, socket, playerId, payload) {
  const player = room.players.get(playerId);

  if (room.phase !== "playing") {
    sendError(socket, "The game is not currently running.");
    return;
  }

  if (!ensureNoDisconnectedPlayers(room, socket)) {
    return;
  }

  if (!player || player.spectator) {
    sendError(socket, "You are not an active player in this round.");
    return;
  }

  if (room.currentPlayerId !== playerId) {
    sendError(socket, "It is not your turn yet.");
    return;
  }

  if (room.pendingDetectiveGuess) {
    sendError(socket, "A Detective guess is still pending.");
    return;
  }

  if (room.pendingDeal) {
    sendError(socket, "A Deal exchange is still pending.");
    return;
  }

  if (room.pendingBoy) {
    sendError(socket, "A Boy reveal is still pending.");
    return;
  }

  if (room.pendingEyewitness) {
    sendError(socket, "An Eyewitness action is still pending.");
    return;
  }

  if (room.pendingMediaManipulation) {
    sendError(socket, "A Media Manipulation exchange is still pending.");
    return;
  }

  if (room.dealNotice) {
    sendError(socket, "Please wait for the Deal result to finish displaying.");
    return;
  }

  if (room.wrongGuessNotice) {
    sendError(socket, "Please wait for the Detective result to finish displaying.");
    return;
  }

  if (room.mediaManipulationNotice) {
    sendError(
      socket,
      "Please wait for the Media Manipulation result to finish displaying."
    );
    return;
  }

  if (room.rumorNotice) {
    sendError(socket, "Please wait for the Rumor result to finish displaying.");
    return;
  }

  const card = player.hand.find((handCard) => handCard.id === payload.cardId);

  if (!card) {
    sendError(socket, "That card is not in your hand.");
    return;
  }

  const mustPlayFirstDiscoverer =
    room.roundNumber === 1 &&
    playerId === room.firstDiscovererId &&
    player.hand.some((handCard) => handCard.type === CARD_TYPES.FIRST_DISCOVERER);

  if (mustPlayFirstDiscoverer && card.type !== CARD_TYPES.FIRST_DISCOVERER) {
    sendError(
      socket,
      "You must play the First Discoverer card on the opening turn."
    );
    return;
  }

  if (card.type === CARD_TYPES.CRIMINAL && player.hand.length !== 1) {
    sendErrorKey(
      socket,
      "criminalLastCardRule",
      {},
      "The Criminal card can only be played when it is your last remaining card."
    );
    return;
  }

  const hasAllDetectiveOpeningHand =
    player.openingHandTypes?.length === MIN_INITIAL_CARD_COUNT &&
    player.openingHandTypes.every(
      (handCardType) => handCardType === CARD_TYPES.DETECTIVE
    );

  if (
    card.type === CARD_TYPES.DETECTIVE &&
    room.roundNumber === 1 &&
    !hasAllDetectiveOpeningHand
  ) {
    sendErrorKey(
      socket,
      "detectiveFirstRoundRule",
      {},
      "The Detective card cannot be played during the first round."
    );
    return;
  }

  player.hand = player.hand.filter((handCard) => handCard.id !== payload.cardId);
  room.discardPile = [
    ...room.discardPile,
    {
      cardType: card.type,
      playedBy: getDisplayName(room, playerId)
    }
  ];
  addLogEntry(room, `${getDisplayName(room, playerId)} played ${card.type}.`);

  if (card.type === CARD_TYPES.DETECTIVE) {
    if (room.roundNumber === 1 && hasAllDetectiveOpeningHand) {
      addLogEntry(
        room,
        `${getDisplayName(room, playerId)} discarded Detective during the first round with an all-Detective opening hand, so no guess is made.`
      );

      room.turnsTakenInRound += 1;

      if (room.turnsTakenInRound >= getPlayableParticipants(room).length) {
        room.roundNumber += 1;
        room.turnsTakenInRound = 0;
        addLogEntry(room, `Round ${room.roundNumber} begins.`);
      }

      advanceTurn(room);
      broadcastState(room);
      return;
    }

    room.pendingDetectiveGuess = {
      detectivePlayerId: playerId,
      selectedTargetPlayerId: ""
    };
    addLogEntry(
      room,
      `${getDisplayName(room, playerId)} revealed Detective. Waiting for the accusation.`
    );
    broadcastState(room);
    return;
  }

  if (card.type === CARD_TYPES.DEAL) {
    const exchangeEligiblePlayers = getExchangeEligiblePlayers(room, playerId);

    if (player.hand.length === 0 || exchangeEligiblePlayers.length === 0) {
      addLogEntry(
        room,
        player.hand.length === 0
          ? `${getDisplayName(room, playerId)} played Deal, but had no card left to exchange.`
          : `${getDisplayName(room, playerId)} played Deal, but no other player had cards to exchange.`
      );
      room.turnsTakenInRound += 1;

      if (room.turnsTakenInRound >= getPlayableParticipants(room).length) {
        room.roundNumber += 1;
        room.turnsTakenInRound = 0;
        addLogEntry(room, `Round ${room.roundNumber} begins.`);
      }

      advanceTurn(room);
      broadcastState(room);
      return;
    }

    room.pendingDeal = {
      stage: "target_selection",
      dealPlayerId: playerId,
      targetPlayerId: null,
      selectedCards: {},
      submittedBy: {}
    };
    addLogEntry(
      room,
      `${getDisplayName(room, playerId)} played Deal and is choosing a player to exchange with.`
    );
    broadcastState(room);
    return;
  }

  if (card.type === CARD_TYPES.BOY) {
    const criminalHolder = getPlayableParticipants(room).find((activePlayer) =>
      activePlayer.hand.some((handCard) => handCard.type === CARD_TYPES.CRIMINAL)
    );

    room.pendingBoy = {
      boyPlayerId: playerId,
      hasCriminal: Boolean(criminalHolder),
      criminalPlayerId: criminalHolder?.id ?? null,
      criminalPlayerName: criminalHolder
        ? getDisplayName(room, criminalHolder.id)
        : ""
    };
    addLogEntry(
      room,
      `${getDisplayName(room, playerId)} played Boy and is checking who holds the Criminal card.`
    );
    broadcastState(room);
    return;
  }

  if (card.type === CARD_TYPES.EYEWITNESS) {
    const eyewitnessEligiblePlayers = getExchangeEligiblePlayers(room, playerId);

    if (eyewitnessEligiblePlayers.length === 0) {
      addLogEntry(
        room,
        `${getDisplayName(room, playerId)} played Eyewitness, but no other player had cards to inspect.`
      );
      room.turnsTakenInRound += 1;

      if (room.turnsTakenInRound >= getPlayableParticipants(room).length) {
        room.roundNumber += 1;
        room.turnsTakenInRound = 0;
        addLogEntry(room, `Round ${room.roundNumber} begins.`);
      }

      advanceTurn(room);
      broadcastState(room);
      return;
    }

    room.pendingEyewitness = {
      stage: "target_selection",
      eyewitnessPlayerId: playerId,
      targetPlayerId: "",
      targetHandSnapshot: []
    };
    addLogEntry(
      room,
      `${getDisplayName(room, playerId)} played Eyewitness and is choosing a player to inspect.`
    );
    broadcastState(room);
    return;
  }

  if (card.type === CARD_TYPES.MEDIA_MANIPULATION) {
    const activePlayers = getPlayableParticipants(room);
    const submittedBy = {};
    let waitingForSelection = false;

    for (const activePlayer of activePlayers) {
      if (activePlayer.hand.length === 0) {
        submittedBy[activePlayer.id] = true;
      } else {
        waitingForSelection = true;
      }
    }

    room.pendingMediaManipulation = {
      actorPlayerId: playerId,
      selectedCards: {},
      submittedBy
    };
    addLogEntry(
      room,
      `${getDisplayName(room, playerId)} played Media Manipulation. Everyone is choosing a card to pass.`
    );

    if (!waitingForSelection) {
      completeMediaManipulationExchange(room);
      return;
    }

    broadcastState(room);
    return;
  }

  if (card.type === CARD_TYPES.RUMOR) {
    const rumorPlayers = getPlayableParticipants(room);
    const cardToPassByPlayerId = {};
    const resultsByPlayerId = {};

    for (const rumorPlayer of rumorPlayers) {
      if (rumorPlayer.hand.length === 0) {
        cardToPassByPlayerId[rumorPlayer.id] = null;
        continue;
      }

      const randomIndex = Math.floor(Math.random() * rumorPlayer.hand.length);
      cardToPassByPlayerId[rumorPlayer.id] = rumorPlayer.hand[randomIndex];
    }

    for (const rumorPlayer of rumorPlayers) {
      const playerIndex = rumorPlayers.findIndex(
        (playerItem) => playerItem.id === rumorPlayer.id
      );
      const nextPlayer = rumorPlayers[(playerIndex + 1) % rumorPlayers.length];
      const previousPlayer =
        rumorPlayers[
          (playerIndex - 1 + rumorPlayers.length) % rumorPlayers.length
        ];
      const givenCard = cardToPassByPlayerId[rumorPlayer.id];
      const receivedCard = cardToPassByPlayerId[previousPlayer.id];

      if (givenCard) {
        rumorPlayer.hand = rumorPlayer.hand.filter((cardItem) => cardItem.id !== givenCard.id);
      }

      resultsByPlayerId[rumorPlayer.id] = {
        givenCardType: givenCard?.type ?? null,
        receivedCardType: receivedCard?.type ?? null,
        nextPlayerName: getDisplayName(room, nextPlayer.id),
        previousPlayerName: getDisplayName(room, previousPlayer.id)
      };
    }

    for (const rumorPlayer of rumorPlayers) {
      const playerIndex = rumorPlayers.findIndex(
        (playerItem) => playerItem.id === rumorPlayer.id
      );
      const previousPlayer =
        rumorPlayers[
          (playerIndex - 1 + rumorPlayers.length) % rumorPlayers.length
        ];
      const receivedCard = cardToPassByPlayerId[previousPlayer.id];

      if (receivedCard) {
        rumorPlayer.hand.push(receivedCard);
      }
    }

    room.rumorNotice = {
      id: crypto.randomUUID(),
      actorName: getDisplayName(room, playerId),
      resultsByPlayerId
    };
    addLogEntry(room, `${getDisplayName(room, playerId)} played Rumor.`);
    broadcastState(room);

    if (room.rumorNoticeTimeout) {
      clearTimeout(room.rumorNoticeTimeout);
    }

    room.rumorNoticeTimeout = setTimeout(() => {
      room.rumorNotice = null;
      room.rumorNoticeTimeout = null;

      room.turnsTakenInRound += 1;

      if (room.turnsTakenInRound >= getPlayableParticipants(room).length) {
        room.roundNumber += 1;
        room.turnsTakenInRound = 0;
        addLogEntry(room, `Round ${room.roundNumber} begins.`);
      }

      advanceTurn(room);
      broadcastState(room);
    }, 4000);
    return;
  }

  if (card.type === CARD_TYPES.INTRIGUE) {
    if (!room.intriguePlayerIds.includes(playerId)) {
      room.intriguePlayerIds = [...room.intriguePlayerIds, playerId];
    }

    addLogEntry(
      room,
      `${getDisplayName(room, playerId)} played Intrigue and joined the Criminal side.`
    );

    room.turnsTakenInRound += 1;

    if (room.turnsTakenInRound >= getPlayableParticipants(room).length) {
      room.roundNumber += 1;
      room.turnsTakenInRound = 0;
      addLogEntry(room, `Round ${room.roundNumber} begins.`);
    }

    advanceTurn(room);
    broadcastState(room);
    return;
  }

  if (card.type === CARD_TYPES.CRIMINAL) {
    finishWithCriminalPlay(room, playerId);
    broadcastState(room);
    return;
  }

  room.turnsTakenInRound += 1;

  if (room.turnsTakenInRound >= getPlayableParticipants(room).length) {
    room.roundNumber += 1;
    room.turnsTakenInRound = 0;
    addLogEntry(room, `Round ${room.roundNumber} begins.`);
  }

  advanceTurn(room);
  broadcastState(room);
}

function handleDetectiveGuess(room, socket, playerId, payload) {
  if (!ensureNoDisconnectedPlayers(room, socket)) {
    return;
  }

  if (!room.pendingDetectiveGuess) {
    sendError(socket, "There is no Detective guess pending right now.");
    return;
  }

  if (room.pendingDetectiveGuess.detectivePlayerId !== playerId) {
    sendError(socket, "Only the active Detective can make this guess.");
    return;
  }

  const targetPlayerId = payload.targetPlayerId;

  if (!targetPlayerId || targetPlayerId === playerId) {
    sendError(socket, "Choose another player to investigate.");
    return;
  }

  const target = room.players.get(targetPlayerId);

  if (!target || target.spectator) {
    sendError(socket, "That player is not available to investigate.");
    return;
  }

  const targetHasCriminal = target.hand.some(
    (handCard) => handCard.type === CARD_TYPES.CRIMINAL
  );
  const targetHasAlibi = target.hand.some(
    (handCard) => handCard.type === CARD_TYPES.ALIBI
  );

  room.pendingDetectiveGuess = null;

  if (targetHasCriminal && !targetHasAlibi) {
    finishWithDetectiveGuess(room, playerId, target.id);
    broadcastState(room);
    return;
  }

  addLogEntry(
    room,
    `${getDisplayName(room, playerId)} investigated ${getDisplayName(room, target.id)}, but the guess was incorrect.`
  );
  room.wrongGuessNotice = {
    message: `A Detective guessed ${getDisplayName(room, target.id)} as a Criminal but it was incorrect.`,
    messageKey: "detectiveGuessIncorrect",
    params: { targetName: getDisplayName(room, target.id) }
  };
  broadcastState(room);

  if (room.wrongGuessTimeout) {
    clearTimeout(room.wrongGuessTimeout);
  }

  room.wrongGuessTimeout = setTimeout(() => {
    room.wrongGuessNotice = null;
    room.wrongGuessTimeout = null;

    room.turnsTakenInRound += 1;

    if (room.turnsTakenInRound >= getPlayableParticipants(room).length) {
      room.roundNumber += 1;
      room.turnsTakenInRound = 0;
      addLogEntry(room, `Round ${room.roundNumber} begins.`);
    }

    advanceTurn(room);
    broadcastState(room);
  }, 3000);
}

function handleDetectiveSelection(room, socket, playerId, payload) {
  if (!ensureNoDisconnectedPlayers(room, socket)) {
    return;
  }

  if (!room.pendingDetectiveGuess) {
    sendError(socket, "There is no Detective guess pending right now.");
    return;
  }

  if (room.pendingDetectiveGuess.detectivePlayerId !== playerId) {
    sendError(socket, "Only the active Detective can change this selection.");
    return;
  }

  const targetPlayerId = String(payload.targetPlayerId ?? "");

  if (!targetPlayerId) {
    room.pendingDetectiveGuess.selectedTargetPlayerId = "";
    broadcastState(room);
    return;
  }

  if (targetPlayerId === playerId) {
    sendError(socket, "Choose another player to investigate.");
    return;
  }

  const target = room.players.get(targetPlayerId);

  if (!target || target.spectator) {
    sendError(socket, "That player is not available to investigate.");
    return;
  }

  room.pendingDetectiveGuess.selectedTargetPlayerId = targetPlayerId;
  broadcastState(room);
}

function handleEyewitnessTargetPreview(room, socket, playerId, payload) {
  if (!ensureNoDisconnectedPlayers(room, socket)) {
    return;
  }

  if (!room.pendingEyewitness || room.pendingEyewitness.stage !== "target_selection") {
    sendError(socket, "There is no Eyewitness target selection pending.");
    return;
  }

  if (room.pendingEyewitness.eyewitnessPlayerId !== playerId) {
    sendError(socket, "Only the Eyewitness player can change this selection.");
    return;
  }

  const targetPlayerId = String(payload.targetPlayerId ?? "");

  if (!targetPlayerId) {
    room.pendingEyewitness.targetPlayerId = "";
    broadcastState(room);
    return;
  }

  if (targetPlayerId === playerId) {
    sendError(socket, "Choose another player to inspect.");
    return;
  }

  const targetPlayer = room.players.get(targetPlayerId);

  if (!targetPlayer || targetPlayer.spectator || targetPlayer.hand.length === 0) {
    sendError(socket, "That player has no cards to inspect.");
    return;
  }

  room.pendingEyewitness.targetPlayerId = targetPlayerId;
  broadcastState(room);
}

function handleEyewitnessTargetSelection(room, socket, playerId, payload) {
  if (!ensureNoDisconnectedPlayers(room, socket)) {
    return;
  }

  if (!room.pendingEyewitness || room.pendingEyewitness.stage !== "target_selection") {
    sendError(socket, "There is no Eyewitness target selection pending.");
    return;
  }

  if (room.pendingEyewitness.eyewitnessPlayerId !== playerId) {
    sendError(socket, "Only the Eyewitness player can choose who to inspect.");
    return;
  }

  const targetPlayerId = String(payload.targetPlayerId ?? "");

  if (!targetPlayerId || targetPlayerId === playerId) {
    sendError(socket, "Choose another player to inspect.");
    return;
  }

  const targetPlayer = room.players.get(targetPlayerId);

  if (!targetPlayer || targetPlayer.spectator || targetPlayer.hand.length === 0) {
    sendError(socket, "That player has no cards to inspect.");
    return;
  }

  room.pendingEyewitness = {
    stage: "reveal",
    eyewitnessPlayerId: playerId,
    targetPlayerId,
    targetHandSnapshot: [...targetPlayer.hand]
  };
  addLogEntry(
    room,
    `${getDisplayName(room, playerId)} is looking at ${getDisplayName(room, targetPlayerId)}'s hand.`
  );
  broadcastState(room);
}

function handleEyewitnessRevealComplete(room, socket, playerId) {
  if (!ensureNoDisconnectedPlayers(room, socket)) {
    return;
  }

  if (!room.pendingEyewitness || room.pendingEyewitness.stage !== "reveal") {
    sendError(socket, "There is no Eyewitness reveal in progress.");
    return;
  }

  if (room.pendingEyewitness.eyewitnessPlayerId !== playerId) {
    sendError(socket, "Only the Eyewitness player can end this reveal.");
    return;
  }

  completeEyewitnessReveal(room);
}

function handleBoyRevealComplete(room, socket, playerId) {
  if (!ensureNoDisconnectedPlayers(room, socket)) {
    return;
  }

  if (!room.pendingBoy) {
    sendError(socket, "There is no Boy reveal in progress.");
    return;
  }

  if (room.pendingBoy.boyPlayerId !== playerId) {
    sendError(socket, "Only the Boy player can close this reveal.");
    return;
  }

  completeBoyReveal(room);
}

function handleDealTargetSelection(room, socket, playerId, payload) {
  if (!ensureNoDisconnectedPlayers(room, socket)) {
    return;
  }

  if (!room.pendingDeal || room.pendingDeal.stage !== "target_selection") {
    sendError(socket, "There is no Deal target selection pending.");
    return;
  }

  if (room.pendingDeal.dealPlayerId !== playerId) {
    sendError(socket, "Only the Deal player can choose the exchange target.");
    return;
  }

  const targetPlayerId = String(payload.targetPlayerId ?? "");
  const dealPlayer = room.players.get(playerId);

  if (!dealPlayer || dealPlayer.hand.length === 0) {
    room.pendingDeal = null;
    addLogEntry(
      room,
      `${getDisplayName(room, playerId)} cannot exchange after playing Deal because no cards remain in hand.`
    );
    room.turnsTakenInRound += 1;

    if (room.turnsTakenInRound >= getPlayableParticipants(room).length) {
      room.roundNumber += 1;
      room.turnsTakenInRound = 0;
      addLogEntry(room, `Round ${room.roundNumber} begins.`);
    }

    advanceTurn(room);
    broadcastState(room);
    return;
  }

  if (!targetPlayerId || targetPlayerId === playerId) {
    sendError(socket, "Choose another player to exchange with.");
    return;
  }

  const targetPlayer = room.players.get(targetPlayerId);

  if (!targetPlayer || targetPlayer.spectator || targetPlayer.hand.length === 0) {
    sendError(socket, "That player cannot exchange cards right now.");
    return;
  }

  room.pendingDeal = {
    ...room.pendingDeal,
    stage: "card_selection",
    targetPlayerId,
    selectedCards: {},
    submittedBy: {}
  };
  addLogEntry(
    room,
    `${getDisplayName(room, playerId)} chose ${getDisplayName(room, targetPlayerId)} for the Deal exchange.`
  );
  broadcastState(room);
}

function handleDealTargetPreview(room, socket, playerId, payload) {
  if (!ensureNoDisconnectedPlayers(room, socket)) {
    return;
  }

  if (!room.pendingDeal || room.pendingDeal.stage !== "target_selection") {
    sendError(socket, "There is no Deal target selection pending.");
    return;
  }

  if (room.pendingDeal.dealPlayerId !== playerId) {
    sendError(socket, "Only the Deal player can change this selection.");
    return;
  }

  const targetPlayerId = String(payload.targetPlayerId ?? "");

  if (!targetPlayerId) {
    room.pendingDeal.targetPlayerId = "";
    broadcastState(room);
    return;
  }

  if (targetPlayerId === playerId) {
    sendError(socket, "Choose another player to exchange with.");
    return;
  }

  const targetPlayer = room.players.get(targetPlayerId);

  if (!targetPlayer || targetPlayer.spectator || targetPlayer.hand.length === 0) {
    sendError(socket, "That player cannot exchange cards right now.");
    return;
  }

  room.pendingDeal.targetPlayerId = targetPlayerId;
  broadcastState(room);
}

function handleDealCardSelection(room, socket, playerId, payload) {
  if (!ensureNoDisconnectedPlayers(room, socket)) {
    return;
  }

  if (!room.pendingDeal || room.pendingDeal.stage !== "card_selection") {
    sendError(socket, "There is no Deal card exchange pending.");
    return;
  }

  if (
    playerId !== room.pendingDeal.dealPlayerId &&
    playerId !== room.pendingDeal.targetPlayerId
  ) {
    sendError(socket, "You are not part of this Deal exchange.");
    return;
  }

  const player = room.players.get(playerId);
  const selectedCardId = String(payload.cardId ?? "");

  if (!player || !selectedCardId) {
    sendError(socket, "Choose one card from your hand.");
    return;
  }

  const selectedCard = player.hand.find((card) => card.id === selectedCardId);

  if (!selectedCard) {
    sendError(socket, "That card is not in your hand.");
    return;
  }

  room.pendingDeal.selectedCards[playerId] = selectedCardId;
  room.pendingDeal.submittedBy[playerId] = true;
  broadcastState(room);

  if (
    room.pendingDeal.submittedBy[room.pendingDeal.dealPlayerId] &&
    room.pendingDeal.submittedBy[room.pendingDeal.targetPlayerId]
  ) {
    completeDealExchange(room);
  }
}

function handleMediaManipulationCardSelection(room, socket, playerId, payload) {
  if (!ensureNoDisconnectedPlayers(room, socket)) {
    return;
  }

  if (!room.pendingMediaManipulation) {
    sendError(socket, "There is no Media Manipulation exchange pending.");
    return;
  }

  const player = room.players.get(playerId);

  if (!player || player.spectator) {
    sendError(socket, "You are not part of this Media Manipulation exchange.");
    return;
  }

  if (player.hand.length === 0) {
    sendError(socket, "You do not have any cards to give.");
    return;
  }

  const selectedCardId = String(payload.cardId ?? "");
  const selectedCard = player.hand.find((card) => card.id === selectedCardId);

  if (!selectedCard) {
    sendError(socket, "That card is not in your hand.");
    return;
  }

  room.pendingMediaManipulation.selectedCards[playerId] = selectedCardId;
  room.pendingMediaManipulation.submittedBy[playerId] = true;
  broadcastState(room);

  const waitingOnPlayer = getPlayableParticipants(room).some(
    (activePlayer) =>
      activePlayer.hand.length > 0 &&
      !room.pendingMediaManipulation.submittedBy[activePlayer.id]
  );

  if (!waitingOnPlayer) {
    completeMediaManipulationExchange(room);
  }
}

function joinRoom(socket, requestedRoomId) {
  const roomId = String(requestedRoomId ?? "").trim().toUpperCase();

  if (!ROOM_ID_PATTERN.test(roomId)) {
    sendError(socket, "Room codes must be exactly 4 letters.");
    return;
  }

  if (clients.has(socket)) {
    return;
  }

  const room = getOrCreateRoom(roomId);

  if (room.players.size >= MAX_PLAYERS) {
    sendError(socket, `This room is full. A maximum of ${MAX_PLAYERS} players is supported.`);
    return;
  }

  const playerId = crypto.randomUUID().slice(0, 8);
  const spectator = room.phase === "playing";

  room.players.set(playerId, {
    id: playerId,
    name: getNextDefaultName(room, playerId),
    hand: [],
    openingHandTypes: [],
    spectator,
    connected: true,
    disconnectedAt: null,
    disconnectTimeout: null
  });
  clients.set(socket, { roomId, playerId });

  socket.send(JSON.stringify({ type: "welcome", playerId, roomId }));

  if (spectator) {
    addLogEntry(
      room,
      `${getDisplayName(room, playerId)} connected to room ${roomId} and will join the next game because a round is already in progress.`
    );
  } else {
    addLogEntry(room, `${getDisplayName(room, playerId)} joined room ${roomId}.`);
  }

  broadcastState(room);
}

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    rooms: rooms.size
  });
});

if (existsSync(DIST_INDEX_FILE)) {
  app.use(express.static(DIST_DIR));

  app.get("*", (request, response, next) => {
    if (request.path === "/health") {
      next();
      return;
    }

    response.sendFile(DIST_INDEX_FILE);
  });
}

wss.on("connection", (socket) => {
  socket.on("message", (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage.toString());
      const session = clients.get(socket);
      const room = session ? rooms.get(session.roomId) : null;
      const activePlayerId = session?.playerId ?? null;

      if (message.type === "join_room") {
        joinRoom(socket, message.roomId);
        return;
      }

      if (!room || !activePlayerId) {
        sendError(socket, "Join a room before sending game actions.");
        return;
      }

      if (message.type === "start_game") {
        if (!canStartGame(room)) {
          const optionsError = validateRoomOptions(room, room.options);

          if (optionsError) {
            sendErrorKey(
              socket,
              optionsError.messageKey,
              optionsError.params ?? {},
              optionsError.message
            );
            return;
          }

          sendError(socket, `You need at least ${MIN_PLAYERS} players and no active round to start a game.`);
          return;
        }

        initializeGame(room);
        broadcastState(room);
        return;
      }

      if (message.type === "set_name") {
        handleSetName(room, socket, activePlayerId, message);
        return;
      }

      if (message.type === "set_options") {
        handleSetOptions(room, socket, activePlayerId, message);
        return;
      }

      if (message.type === "play_card") {
        handlePlayCard(room, socket, activePlayerId, message);
        return;
      }

      if (message.type === "detective_select") {
        handleDetectiveSelection(room, socket, activePlayerId, message);
        return;
      }

      if (message.type === "detective_guess") {
        handleDetectiveGuess(room, socket, activePlayerId, message);
        return;
      }

      if (message.type === "deal_select_target") {
        handleDealTargetSelection(room, socket, activePlayerId, message);
        return;
      }

      if (message.type === "deal_preview_target") {
        handleDealTargetPreview(room, socket, activePlayerId, message);
        return;
      }

      if (message.type === "deal_select_card") {
        handleDealCardSelection(room, socket, activePlayerId, message);
        return;
      }

      if (message.type === "eyewitness_preview_target") {
        handleEyewitnessTargetPreview(room, socket, activePlayerId, message);
        return;
      }

      if (message.type === "eyewitness_select_target") {
        handleEyewitnessTargetSelection(room, socket, activePlayerId, message);
        return;
      }

      if (message.type === "eyewitness_finish_reveal") {
        handleEyewitnessRevealComplete(room, socket, activePlayerId);
        return;
      }

      if (message.type === "boy_finish_reveal") {
        handleBoyRevealComplete(room, socket, activePlayerId);
        return;
      }

      if (message.type === "media_manipulation_select_card") {
        handleMediaManipulationCardSelection(room, socket, activePlayerId, message);
        return;
      }

      if (message.type === "return_to_lobby") {
        if (room.phase !== "finished") {
          sendError(socket, "You can only return to the lobby after the game ends.");
          return;
        }

        resetToLobby(room);
        broadcastState(room);
      }
    } catch (error) {
      console.error("Invalid socket message", error);
      sendError(socket, "That action could not be processed.");
    }
  });

  socket.on("close", () => {
    const session = clients.get(socket);

    if (!session) {
      return;
    }

    clients.delete(socket);
    const room = rooms.get(session.roomId);

    if (!room) {
      return;
    }

    const leavingPlayer = room.players.get(session.playerId);

    if (!leavingPlayer) {
      maybeDeleteRoom(room);
      return;
    }

    if (room.phase === "playing" && !leavingPlayer.spectator) {
      leavingPlayer.connected = false;
      leavingPlayer.disconnectedAt = Date.now();
      clearPlayerDisconnectTimer(leavingPlayer);
      leavingPlayer.disconnectTimeout = setTimeout(() => {
        clearPlayerDisconnectTimer(leavingPlayer);
        terminateGameDueToDisconnection(room, leavingPlayer.name);
      }, RECONNECT_GRACE_PERIOD_MS);

      addLogEntry(
        room,
        `${leavingPlayer.name} disconnected. Waiting up to 3 minutes for them to rejoin.`
      );
      broadcastState(room);
      return;
    }

    clearPlayerDisconnectTimer(leavingPlayer);
    room.players.delete(session.playerId);

    if (room.turnOrder.includes(session.playerId)) {
      room.turnOrder = room.turnOrder.filter((id) => id !== session.playerId);
    }

    if (room.firstDiscovererId === session.playerId) {
      room.firstDiscovererId = room.turnOrder[0] ?? null;
    }

    addLogEntry(room, `${leavingPlayer.name} left the table.`);
    broadcastState(room);
    maybeDeleteRoom(room);
  });
});

server.listen(PORT, () => {
  console.log(`Multiplayer server listening on http://localhost:${PORT}`);
});
