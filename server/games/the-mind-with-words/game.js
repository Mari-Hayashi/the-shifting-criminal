export const GAME_TYPE = "mind_with_words";
export const MINIMUM_PLAYERS = 2;

const MESSAGE_TYPES = {
  SET_TOPIC: "mind_set_topic",
  SUBMIT_ANSWER: "mind_submit_answer",
  REVEAL_CARD: "mind_reveal_card"
};

const FINAL_STAGES = ["success", "failed"];
const MIN_TOPIC_LENGTH = 3;
const MAX_TEXT_LENGTH = 120;
const CARD_COUNT = 100;

export function initializeGame(room, helpers) {
  const activePlayers = helpers.getConnectedPlayers(room);

  room.phase = "playing";
  room.activeGame = GAME_TYPE;
  room.currentPlayerId = null;
  room.turnOrder = helpers.shuffle(activePlayers.map((player) => player.id));
  room.discardPile = [];
  room.logEntries = [];
  room.winner = null;
  room.gameError = null;
  room.mindWithWords = {
    stage: "topic",
    topic: "",
    cardsByPlayerId: {},
    answersByPlayerId: {},
    revealedCards: [],
    hadMistake: false
  };
  helpers.clearTransientStateOnFinish(room);

  for (const player of room.players.values()) {
    player.spectator = !player.connected;
    player.hand = [];
    player.openingHandTypes = [];
  }

  helpers.addLogEntry(
    room,
    `The Mind with Words started with ${activePlayers.length} players.`
  );
}

export function getClientState(room, playerId, orderedPlayers) {
  const game = room.mindWithWords;

  if (!game) {
    return null;
  }

  return {
    stage: game.stage,
    topic: game.topic,
    hadMistake: game.hadMistake,
    yourNumber: game.cardsByPlayerId[playerId] ?? null,
    yourAnswer: game.answersByPlayerId[playerId] ?? "",
    yourAnswerSubmitted: Boolean(game.answersByPlayerId[playerId]),
    revealedCards: game.revealedCards,
    players: orderedPlayers
      .filter((player) => !player.spectator)
      .map((player) => {
        const reveal = game.revealedCards.find(
          (entry) => entry.playerId === player.id
        );

        return {
          id: player.id,
          name: player.name,
          answerSubmitted: Boolean(game.answersByPlayerId[player.id]),
          answer: game.answersByPlayerId[player.id] ?? "",
          revealedNumber:
            reveal?.number ??
            (FINAL_STAGES.includes(game.stage)
              ? game.cardsByPlayerId[player.id]
              : null),
          revealCorrect: reveal?.correct ?? null
        };
      })
  };
}

export function handleSocketMessage(context) {
  const { message } = context;

  if (message.type === MESSAGE_TYPES.SET_TOPIC) {
    handleTopic(context);
    return true;
  }

  if (message.type === MESSAGE_TYPES.SUBMIT_ANSWER) {
    handleAnswer(context);
    return true;
  }

  if (message.type === MESSAGE_TYPES.REVEAL_CARD) {
    handleReveal(context);
    return true;
  }

  return false;
}

export function canReturnToLobby(room) {
  return (
    room.phase === "playing" &&
    room.activeGame === GAME_TYPE &&
    FINAL_STAGES.includes(room.mindWithWords?.stage)
  );
}

export function resetGame(room) {
  room.mindWithWords = null;
}

function handleTopic({ room, socket, playerId, message, helpers }) {
  const game = room.mindWithWords;

  if (room.activeGame !== GAME_TYPE || game?.stage !== "topic") {
    helpers.sendError(socket, "The topic cannot be changed right now.");
    return;
  }

  const topic = normalizeText(message.topic);

  if (topic.length < MIN_TOPIC_LENGTH || topic.length > MAX_TEXT_LENGTH) {
    helpers.sendError(socket, "Choose a topic between 3 and 120 characters.");
    return;
  }

  const numbers = helpers.shuffle(
    Array.from({ length: CARD_COUNT }, (_, index) => index + 1)
  );
  const playerIds = room.turnOrder.filter(
    (id) => !room.players.get(id)?.spectator
  );

  game.topic = topic;
  game.cardsByPlayerId = Object.fromEntries(
    playerIds.map((id, index) => [id, numbers[index]])
  );
  game.stage = "answers";
  helpers.addLogEntry(
    room,
    `${helpers.getDisplayName(room, playerId)} set the topic: ${topic}`
  );
  helpers.broadcastState(room);
}

function handleAnswer({ room, socket, playerId, message, helpers }) {
  const game = room.mindWithWords;

  if (room.activeGame !== GAME_TYPE || game?.stage !== "answers") {
    helpers.sendError(socket, "Answers cannot be submitted right now.");
    return;
  }

  if (!(playerId in game.cardsByPlayerId)) {
    helpers.sendError(socket, "You are not playing in this round.");
    return;
  }

  const answer = normalizeText(message.answer);

  if (answer.length < 1 || answer.length > MAX_TEXT_LENGTH) {
    helpers.sendError(socket, "Enter an answer up to 120 characters.");
    return;
  }

  game.answersByPlayerId[playerId] = answer;
  const playerIds = Object.keys(game.cardsByPlayerId);

  if (playerIds.every((id) => Boolean(game.answersByPlayerId[id]))) {
    game.stage = "discussion";
    helpers.addLogEntry(
      room,
      "Everyone has answered. Discuss the answers and reveal the lowest card first."
    );
  }

  helpers.broadcastState(room);
}

function handleReveal({ room, socket, playerId, helpers }) {
  const game = room.mindWithWords;

  if (room.activeGame !== GAME_TYPE || game?.stage !== "discussion") {
    helpers.sendError(socket, "Cards cannot be revealed right now.");
    return;
  }

  if (game.revealedCards.some((entry) => entry.playerId === playerId)) {
    helpers.sendError(socket, "You already revealed your card.");
    return;
  }

  const remainingPlayerIds = Object.keys(game.cardsByPlayerId).filter(
    (id) => !game.revealedCards.some((entry) => entry.playerId === id)
  );
  const number = game.cardsByPlayerId[playerId];
  const lowerPlayerIds = remainingPlayerIds
    .filter((id) => id !== playerId && game.cardsByPlayerId[id] < number)
    .sort(
      (leftId, rightId) =>
        game.cardsByPlayerId[leftId] - game.cardsByPlayerId[rightId]
    );

  if (lowerPlayerIds.length > 0) {
    game.hadMistake = true;

    for (const lowerPlayerId of lowerPlayerIds) {
      game.revealedCards.push({
        playerId: lowerPlayerId,
        name: helpers.getDisplayName(room, lowerPlayerId),
        number: game.cardsByPlayerId[lowerPlayerId],
        autoRevealed: true,
        correct: false
      });
    }

    helpers.addLogEntry(
      room,
      `${helpers.getDisplayName(room, playerId)} revealed ${number} out of order. ${lowerPlayerIds.length} lower card${lowerPlayerIds.length === 1 ? " was" : "s were"} revealed.`
    );
  }

  game.revealedCards.push({
    playerId,
    name: helpers.getDisplayName(room, playerId),
    number,
    autoRevealed: false,
    correct: lowerPlayerIds.length === 0
  });

  if (game.revealedCards.length === Object.keys(game.cardsByPlayerId).length) {
    game.stage = game.hadMistake ? "failed" : "success";
    helpers.addLogEntry(
      room,
      game.hadMistake
        ? "All remaining cards have been revealed."
        : "Every card was revealed in ascending order."
    );
  }

  helpers.broadcastState(room);
}

function normalizeText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}
