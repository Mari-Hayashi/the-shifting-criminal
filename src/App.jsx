import { useEffect, useMemo, useRef, useState } from "react";
import backCard from "./assets/Back.png";
import criminalCard from "./assets/Criminal.png";
import detectiveCard from "./assets/Detective.png";
import firstDiscovererCard from "./assets/First_Discoverer.png";
import manCard from "./assets/Man.png";

const CARD_TEXT = {
  Criminal:
    "You can only play this when it is the last card in your hand. If you do, you win.",
  "First Discoverer":
    "No action. The player holding this card starts, and it must be played in round one.",
  Detective:
    "Guess another player. If they are holding the Criminal card, everyone except the Criminal wins.",
  Man: "No action. Reveal it and the turn moves on."
};

const CARD_IMAGES = {
  Criminal: criminalCard,
  Detective: detectiveCard,
  "First Discoverer": firstDiscovererCard,
  Man: manCard
};

function CardBackStack({ count }) {
  const visibleCards = Math.min(count, 4);

  return (
    <div className="card-back-stack" aria-label={`${count} cards remaining`}>
      {Array.from({ length: visibleCards }).map((_, index) => (
        <img
          key={`${count}-${index}`}
          className="card-back-image"
          src={backCard}
          alt=""
          style={{
            transform: `translate(${index * 8}px, ${index * 2}px) rotate(${index * 2}deg)`
          }}
        />
      ))}
      <span className="card-count-chip">{count}</span>
    </div>
  );
}

function App() {
  const [playerId, setPlayerId] = useState(null);
  const [status, setStatus] = useState("Connecting...");
  const [gameState, setGameState] = useState({
    phase: "lobby",
    canStart: false,
    currentPlayerId: null,
    players: [],
    yourName: "",
    yourHand: [],
    discardPile: [],
    logEntries: [],
    winner: null,
    wrongGuessNotice: null,
    pendingDetectiveGuess: null,
    roundNumber: 0,
    firstDiscovererId: null,
    yourTurn: false,
    minimumPlayers: 3,
    mustPlayFirstDiscoverer: false
  });
  const [selectedCardId, setSelectedCardId] = useState(null);
  const [detectiveTargetId, setDetectiveTargetId] = useState("");
  const [notice, setNotice] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [showDetectiveModal, setShowDetectiveModal] = useState(false);
  const socketRef = useRef(null);
  const previousPendingDetectiveIdRef = useRef(null);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${window.location.hostname}:3001`);

    socketRef.current = socket;

    socket.addEventListener("open", () => {
      setStatus("Connected");
    });

    socket.addEventListener("close", () => {
      setStatus("Disconnected");
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);

      if (message.type === "welcome") {
        setPlayerId(message.playerId);
      }

      if (message.type === "state") {
        setGameState(message);
        setNameInput((current) =>
          current.trim().length > 0 ? current : message.yourName ?? ""
        );
        setNotice("");
      }

      if (message.type === "error") {
        setNotice(message.message);
      }
    });

    return () => {
      socket.close();
    };
  }, []);

  useEffect(() => {
    const hasSelectedCard = gameState.yourHand.some(
      (card) => card.id === selectedCardId
    );

    if (!hasSelectedCard) {
      setSelectedCardId(null);
      setDetectiveTargetId("");
    }
  }, [gameState.yourHand, selectedCardId]);

  useEffect(() => {
    if (!gameState.pendingDetectiveGuess) {
      setDetectiveTargetId("");
      setShowDetectiveModal(false);
      return;
    }

    if (gameState.pendingDetectiveGuess.waitingForGuess) {
      setDetectiveTargetId(
        gameState.pendingDetectiveGuess.selectedTargetPlayerId ?? ""
      );
    }
  }, [gameState.pendingDetectiveGuess]);

  useEffect(() => {
    const nextPendingDetectiveId =
      gameState.pendingDetectiveGuess?.detectivePlayerId ?? null;
    const previousPendingDetectiveId = previousPendingDetectiveIdRef.current;

    if (!nextPendingDetectiveId) {
      setShowDetectiveModal(false);
      previousPendingDetectiveIdRef.current = null;
      return;
    }

    if (previousPendingDetectiveId === nextPendingDetectiveId) {
      setShowDetectiveModal(true);
      return;
    }

    previousPendingDetectiveIdRef.current = nextPendingDetectiveId;
    setShowDetectiveModal(false);
    const timeoutId = window.setTimeout(() => {
      setShowDetectiveModal(true);
    }, 1000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [gameState.pendingDetectiveGuess]);

  const selectedCard = useMemo(
    () => gameState.yourHand.find((card) => card.id === selectedCardId) ?? null,
    [gameState.yourHand, selectedCardId]
  );

  const eligibleTargets = useMemo(
    () =>
      gameState.players.filter(
        (player) => !player.spectator && player.id !== playerId
      ),
    [gameState.players, playerId]
  );
  const detectivePopupTargets = useMemo(() => {
    const detectiveId = gameState.pendingDetectiveGuess?.detectivePlayerId;

    return gameState.players.filter(
      (player) => !player.spectator && player.id !== detectiveId
    );
  }, [gameState.pendingDetectiveGuess, gameState.players]);

  const handCount = gameState.yourHand.length;
  const canPressStart = gameState.canStart && status === "Connected";
  const canSaveName =
    status === "Connected" &&
    gameState.phase !== "playing" &&
    nameInput.trim().length > 0 &&
    nameInput.trim() !== gameState.yourName;
  const canSelectCards =
    status === "Connected" &&
    gameState.phase === "playing" &&
    gameState.yourTurn &&
    !gameState.pendingDetectiveGuess &&
    !gameState.wrongGuessNotice;
  const canPlayCard =
    status === "Connected" &&
    gameState.phase === "playing" &&
    gameState.yourTurn &&
    Boolean(selectedCard) &&
    !gameState.pendingDetectiveGuess &&
    !gameState.wrongGuessNotice;
  const canSubmitDetectiveGuess =
    status === "Connected" &&
    gameState.pendingDetectiveGuess?.waitingForGuess &&
    Boolean(detectiveTargetId) &&
    !gameState.wrongGuessNotice;
  const syncedDetectiveTargetId =
    gameState.pendingDetectiveGuess?.selectedTargetPlayerId ?? "";
  const didCurrentPlayerWin = Boolean(
    playerId &&
      gameState.winner?.winners?.includes(playerId)
  );

  const handleStartGame = () => {
    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN || !canPressStart) {
      return;
    }

    socket.send(JSON.stringify({ type: "start_game" }));
  };

  const handleSaveName = () => {
    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN || !canSaveName) {
      return;
    }

    socket.send(JSON.stringify({ type: "set_name", name: nameInput.trim() }));
  };

  const handlePlayCard = () => {
    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN || !canPlayCard) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "play_card",
        cardId: selectedCard.id
      })
    );
    setSelectedCardId(null);
    setDetectiveTargetId("");
    setNotice("");
  };

  const handleDetectiveGuess = () => {
    const socket = socketRef.current;

    if (
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      !canSubmitDetectiveGuess
    ) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "detective_guess",
        targetPlayerId: detectiveTargetId
      })
    );
    setDetectiveTargetId("");
    setNotice("");
  };

  const handleDetectiveTargetChange = (nextTargetPlayerId) => {
    setDetectiveTargetId(nextTargetPlayerId);

    const socket = socketRef.current;

    if (
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      !gameState.pendingDetectiveGuess?.waitingForGuess
    ) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "detective_select",
        targetPlayerId: nextTargetPlayerId
      })
    );
  };

  const handleReturnToLobby = () => {
    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify({ type: "return_to_lobby" }));
    setSelectedCardId(null);
    setDetectiveTargetId("");
    setNotice("");
  };

  return (
    <main className="page-shell">
      <section className="hero">
        <p className="eyebrow">Deduction Card Game Prototype</p>
        <h1>The Shifting Culprit</h1>
        <p className="subcopy">
          Wait for at least three players, then press <strong>Stat Game</strong>.
          Your hand is private, but every played card is revealed to the whole table.
        </p>
      </section>

      <section className="table-layout">
        <article className="panel players-panel">
          <div className="panel-header">
            <div>
              <span className="label">Table</span>
              <strong>{gameState.players.length} connected</strong>
            </div>
            <button
              type="button"
              className="start-button"
              onClick={handleStartGame}
              disabled={!canPressStart}
            >
              Stat Game
            </button>
          </div>

          <div className="name-box">
            <label className="name-form">
              <span className="label">Your Name</span>
              <input
                type="text"
                maxLength={24}
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
                disabled={gameState.phase === "playing"}
                placeholder="Enter your name"
              />
            </label>
            <button
              type="button"
              className="secondary-button"
              onClick={handleSaveName}
              disabled={!canSaveName}
            >
              Save Name
            </button>
          </div>

          <div className="players-list">
            {gameState.players.map((player) => (
              <div
                key={player.id}
                className={`player-row ${
                  player.id === gameState.currentPlayerId ? "is-active" : ""
                } ${player.id === playerId ? "is-self" : ""}`}
              >
                <div className="player-summary">
                  <strong>
                    {player.id === playerId ? `${player.name} (You)` : player.name}
                  </strong>
                </div>
                {!player.spectator && (
                  <CardBackStack count={player.handCount} />
                )}
                <span className="player-badge">
                  {player.id === gameState.firstDiscovererId
                    ? "First"
                    : player.id === gameState.currentPlayerId
                      ? "Turn"
                      : "Player"}
                </span>
              </div>
            ))}
          </div>

          {notice && <div className="notice-box">{notice}</div>}
        </article>

        <div className="center-column">
          <article className="panel center-panel">
            <div className="panel-header">
              <div>
                <span className="label">Discard Pile</span>
              </div>
            </div>

            <div className="discard-card">
              {gameState.discardPile.length > 0 ? (
                <>
                  <div className="discard-meta">
                    <span className="label">Last played by</span>
                    <strong>
                      {gameState.discardPile[gameState.discardPile.length - 1].playedBy}
                    </strong>
                  </div>
                  <img
                    className="discard-image"
                    src={
                      CARD_IMAGES[
                        gameState.discardPile[gameState.discardPile.length - 1].cardType
                      ]
                    }
                    alt={gameState.discardPile[gameState.discardPile.length - 1].cardType}
                  />
                </>
              ) : (
                <>
                  <span className="label">Table state</span>
                  <strong>No cards have been played yet.</strong>
                  <p>The first reveal will appear here once the round begins.</p>
                </>
              )}
            </div>
          </article>

          <article className="panel hand-panel">
            <div className="panel-header">
              <div>
                <span className="label">Your Hand</span>
              </div>
            </div>

            <div className="hand-grid">
              {gameState.yourHand.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  className={`hand-card ${
                    canSelectCards && !selectedCardId ? "is-ready" : ""
                  } ${
                    selectedCardId === card.id ? "is-selected" : ""
                  }`}
                  disabled={!canSelectCards}
                  onClick={() => {
                    if (!canSelectCards) {
                      return;
                    }

                    setSelectedCardId(card.id);
                    if (card.type !== "Detective") {
                      setDetectiveTargetId("");
                    }
                  }}
                >
                  <img
                    className="hand-card-image"
                    src={CARD_IMAGES[card.type]}
                    alt={card.type}
                  />
                </button>
              ))}
            </div>

            <button
              type="button"
              className="play-button"
              onClick={handlePlayCard}
              disabled={!canPlayCard}
            >
              Play Selected Card
            </button>
          </article>
        </div>
      </section>

      {gameState.pendingDetectiveGuess && showDetectiveModal && (
        <div className="modal-backdrop">
          <section className="detective-modal">
            <span className="label">Detective Guess</span>
            <img
              className="detective-popup-card"
              src={detectiveCard}
              alt="Detective card"
            />
            <strong>
              {gameState.pendingDetectiveGuess.waitingForGuess
                ? "Choose who you want to accuse."
                : `${gameState.pendingDetectiveGuess.detectiveName} is deciding who to accuse.`}
            </strong>
            <p>
              The Detective card has been played. Take a moment to discuss
              before the accusation is locked in.
            </p>

            <label className="target-picker">
              <span className="label">Suspected Criminal</span>
              <select
                value={
                  gameState.pendingDetectiveGuess.waitingForGuess
                    ? detectiveTargetId
                    : syncedDetectiveTargetId
                }
                onChange={(event) =>
                  handleDetectiveTargetChange(event.target.value)
                }
                disabled={!gameState.pendingDetectiveGuess.waitingForGuess}
              >
                <option value="">Choose a player</option>
                {detectivePopupTargets.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name}
                  </option>
                ))}
              </select>
            </label>

            {gameState.pendingDetectiveGuess.waitingForGuess && (
              <button
                type="button"
                className="play-button"
                onClick={handleDetectiveGuess}
                disabled={!canSubmitDetectiveGuess}
              >
                Confirm Detective Guess
              </button>
            )}
          </section>
        </div>
      )}

      {gameState.wrongGuessNotice && (
        <div className="modal-backdrop">
          <section className="detective-modal detective-result-modal">
            <span className="label">Detective Result</span>
            <img
              className="detective-popup-card"
              src={detectiveCard}
              alt="Detective card"
            />
            <strong>{gameState.wrongGuessNotice.message}</strong>
          </section>
        </div>
      )}

      {gameState.winner && (
        <div className="modal-backdrop">
          <section
            className={`detective-modal detective-result-modal ${
              didCurrentPlayerWin ? "result-win" : "result-loss"
            }`}
          >
            <span className="label">Result</span>
            <h2 className="result-heading">
              {didCurrentPlayerWin ? "YOU WON" : "YOU LOST"}
            </h2>
            {(gameState.winner.reason === "criminal_played" ||
              gameState.winner.reason === "detective_guess") && (
              <img
                className="detective-popup-card"
                src={
                  gameState.winner.reason === "criminal_played"
                    ? criminalCard
                    : detectiveCard
                }
                alt={
                  gameState.winner.reason === "criminal_played"
                    ? "Criminal card"
                    : "Detective card"
                }
              />
            )}
            <strong>{gameState.winner.message}</strong>
            <button
              type="button"
              className="play-button modal-action-button"
              onClick={handleReturnToLobby}
            >
              Back to Lobby
            </button>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
