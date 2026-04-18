import { useEffect, useMemo, useRef, useState } from "react";
import backCard from "./assets/Back.png";
import alibiCard from "./assets/Alibi.png";
import arrowLeftImage from "./assets/arrow_left.png";
import backgroundImage from "./assets/Background.png";
import criminalCard from "./assets/Criminal.png";
import dealCard from "./assets/Deal.png";
import detectiveCard from "./assets/Detective.png";
import eyewitnessCard from "./assets/Eyewitness.png";
import firstDiscovererCard from "./assets/First_Discoverer.png";
import intrigueCard from "./assets/Intrigue.png";
import { translate } from "./i18n/translations";
import manCard from "./assets/Man.png";
import mediaManipulationCard from "./assets/Media_Manipulation.png";
import rumorCard from "./assets/Rumor.png";

const ROOM_ID_PATTERN = /^[A-Z]{4}$/;

function createRandomRoomId() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return Array.from({ length: 4 }, () =>
    letters[Math.floor(Math.random() * letters.length)]
  ).join("");
}

function ensureRoomIdFromLocation() {
  const pathRoomId = window.location.pathname.replace(/^\/+|\/+$/g, "").toUpperCase();

  if (ROOM_ID_PATTERN.test(pathRoomId)) {
    if (window.location.pathname !== `/${pathRoomId}`) {
      window.history.replaceState(null, "", `/${pathRoomId}`);
    }

    return pathRoomId;
  }

  const nextRoomId = createRandomRoomId();
  window.history.replaceState(null, "", `/${nextRoomId}`);
  return nextRoomId;
}

const CARD_TEXT = {
  Alibi:
    "No action when played. While you still hold Alibi with Criminal, Detective guesses against you fail.",
  Criminal:
    "You can only play this when it is the last card in your hand. If you do, you win.",
  "First Discoverer":
    "No action. The player holding this card starts, and it must be played in round one.",
  Detective:
    "Guess another player. If they are holding the Criminal card, everyone except the Criminal wins.",
  Deal:
    "Pick another player with cards in hand. You each choose one card to exchange.",
  Eyewitness:
    "Pick another player with cards in hand, then privately look at all cards in their hand.",
  "Media Manipulation":
    "Everyone chooses one card to pass to the next player.",
  Rumor:
    "Everyone passes one random card to the next player. Players without cards only receive.",
  Man: "No action. Reveal it and the turn moves on."
};

const CARD_IMAGES = {
  Alibi: alibiCard,
  Criminal: criminalCard,
  Deal: dealCard,
  Detective: detectiveCard,
  Eyewitness: eyewitnessCard,
  "First Discoverer": firstDiscovererCard,
  Intrigue: intrigueCard,
  "Media Manipulation": mediaManipulationCard,
  Rumor: rumorCard,
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
  const [roomId, setRoomId] = useState("");
  const [language, setLanguage] = useState(() => {
    const savedLanguage = window.localStorage.getItem("site-language");
    return savedLanguage === "ja" ? "ja" : "en";
  });
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
    gameError: null,
    disconnectedNotice: null,
    dealNotice: null,
    wrongGuessNotice: null,
    mediaManipulationNotice: null,
    rumorNotice: null,
    pendingDeal: null,
    pendingEyewitness: null,
    pendingMediaManipulation: null,
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
  const [showPendingActionModal, setShowPendingActionModal] = useState(false);
  const [showPendingDealModal, setShowPendingDealModal] = useState(false);
  const [showPendingEyewitnessModal, setShowPendingEyewitnessModal] =
    useState(false);
  const [showPendingMediaModal, setShowPendingMediaModal] = useState(false);
  const [showDealResultModal, setShowDealResultModal] = useState(false);
  const [showMediaResultModal, setShowMediaResultModal] = useState(false);
  const [showRumorModal, setShowRumorModal] = useState(false);
  const [visibleHand, setVisibleHand] = useState([]);
  const [dealTargetId, setDealTargetId] = useState("");
  const [eyewitnessTargetId, setEyewitnessTargetId] = useState("");
  const [selectedDealCardId, setSelectedDealCardId] = useState("");
  const [selectedMediaCardId, setSelectedMediaCardId] = useState("");
  const socketRef = useRef(null);
  const previousPendingActionPlayerIdRef = useRef(null);
  const previousPendingDealPlayerIdRef = useRef(null);
  const previousPendingEyewitnessPlayerIdRef = useRef(null);
  const previousPendingMediaPlayerIdRef = useRef(null);
  const previousDealResultIdRef = useRef(null);
  const previousMediaResultIdRef = useRef(null);
  const previousRumorNoticeIdRef = useRef(null);

  const t = (key, params) => translate(language, key, params);
  const translateMessage = (messageObject) => {
    if (messageObject?.messageKey) {
      return t(messageObject.messageKey, messageObject.params);
    }

    return messageObject?.message ?? "";
  };

  useEffect(() => {
    window.localStorage.setItem("site-language", language);
  }, [language]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--page-background-image",
      `url(${backgroundImage})`
    );

    const nextRoomId = ensureRoomIdFromLocation();
    setRoomId(nextRoomId);
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socketUrl = import.meta.env.DEV
      ? `${protocol}://${window.location.hostname}:3001`
      : `${protocol}://${window.location.host}`;
    const socket = new WebSocket(socketUrl);

    socketRef.current = socket;

    socket.addEventListener("open", () => {
      setStatus("Connected");
      socket.send(JSON.stringify({ type: "join_room", roomId: nextRoomId }));
    });

    socket.addEventListener("close", () => {
      setStatus("Disconnected");
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);

      if (message.type === "welcome") {
        setPlayerId(message.playerId);
        if (message.roomId) {
          setRoomId(message.roomId);
        }
      }

      if (message.type === "state") {
        setGameState(message);
        if (message.roomId) {
          setRoomId(message.roomId);
        }
        setNameInput((current) =>
          current.trim().length > 0 ? current : message.yourName ?? ""
        );
        setNotice("");
      }

      if (message.type === "error") {
        setNotice(
          message.messageKey
            ? t(message.messageKey, message.params)
            : message.message
        );
      }
    });

    return () => {
      document.documentElement.style.removeProperty("--page-background-image");
      socket.close();
    };
  }, []);

  useEffect(() => {
    if (gameState.rumorNotice && !showRumorModal) {
      return;
    }

    setVisibleHand(gameState.yourHand);
  }, [gameState.yourHand, gameState.rumorNotice, showRumorModal]);

  useEffect(() => {
    const hasSelectedCard = visibleHand.some(
      (card) => card.id === selectedCardId
    );

    if (!hasSelectedCard) {
      setSelectedCardId(null);
      setDetectiveTargetId("");
    }
  }, [visibleHand, selectedCardId]);

  useEffect(() => {
    if (!gameState.pendingDetectiveGuess) {
      setDetectiveTargetId("");
      setShowPendingActionModal(false);
      return;
    }

    if (gameState.pendingDetectiveGuess.waitingForGuess) {
      const syncedTargetPlayerId =
        gameState.pendingDetectiveGuess.selectedTargetPlayerId ?? "";

      setDetectiveTargetId((currentTargetPlayerId) =>
        syncedTargetPlayerId || currentTargetPlayerId
      );
      return;
    }

    setDetectiveTargetId(
      gameState.pendingDetectiveGuess.selectedTargetPlayerId ?? ""
    );
  }, [gameState.pendingDetectiveGuess]);

  useEffect(() => {
    if (!gameState.pendingDeal) {
      setDealTargetId("");
      setSelectedDealCardId("");
      setShowPendingDealModal(false);
      return;
    }

    if (gameState.pendingDeal.waitingForTarget) {
      setDealTargetId(gameState.pendingDeal.targetPlayerId ?? "");
    }
  }, [gameState.pendingDeal]);

  useEffect(() => {
    if (!gameState.pendingEyewitness) {
      setEyewitnessTargetId("");
      setShowPendingEyewitnessModal(false);
      return;
    }

    if (gameState.pendingEyewitness.waitingForTarget) {
      setEyewitnessTargetId(gameState.pendingEyewitness.targetPlayerId ?? "");
    }
  }, [gameState.pendingEyewitness]);

  useEffect(() => {
    if (!gameState.pendingMediaManipulation) {
      setSelectedMediaCardId("");
      setShowPendingMediaModal(false);
      return;
    }
  }, [gameState.pendingMediaManipulation]);

  useEffect(() => {
    const nextPendingMediaPlayerId =
      gameState.pendingMediaManipulation?.actorPlayerId ?? null;
    const previousPendingMediaPlayerId = previousPendingMediaPlayerIdRef.current;

    if (!nextPendingMediaPlayerId) {
      setShowPendingMediaModal(false);
      previousPendingMediaPlayerIdRef.current = null;
      return;
    }

    if (previousPendingMediaPlayerId === nextPendingMediaPlayerId) {
      setShowPendingMediaModal(true);
      return;
    }

    previousPendingMediaPlayerIdRef.current = nextPendingMediaPlayerId;
    setShowPendingMediaModal(false);
    const timeoutId = window.setTimeout(() => {
      setShowPendingMediaModal(true);
    }, 1000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [gameState.pendingMediaManipulation]);

  useEffect(() => {
    const nextDealResultId = gameState.dealNotice?.id ?? null;
    const previousDealResultId = previousDealResultIdRef.current;

    if (!nextDealResultId) {
      setShowDealResultModal(false);
      previousDealResultIdRef.current = null;
      return;
    }

    if (previousDealResultId === nextDealResultId) {
      setShowDealResultModal(true);
      return;
    }

    previousDealResultIdRef.current = nextDealResultId;
    setShowDealResultModal(true);
  }, [gameState.dealNotice]);

  useEffect(() => {
    const nextMediaResultId = gameState.mediaManipulationNotice?.id ?? null;
    const previousMediaResultId = previousMediaResultIdRef.current;

    if (!nextMediaResultId) {
      setShowMediaResultModal(false);
      previousMediaResultIdRef.current = null;
      return;
    }

    if (previousMediaResultId === nextMediaResultId) {
      setShowMediaResultModal(true);
      return;
    }

    previousMediaResultIdRef.current = nextMediaResultId;
    setShowMediaResultModal(true);
  }, [gameState.mediaManipulationNotice]);

  useEffect(() => {
    const nextRumorNoticeId = gameState.rumorNotice?.id ?? null;
    const previousRumorNoticeId = previousRumorNoticeIdRef.current;

    if (!nextRumorNoticeId) {
      setShowRumorModal(false);
      previousRumorNoticeIdRef.current = null;
      return;
    }

    if (previousRumorNoticeId === nextRumorNoticeId) {
      setShowRumorModal(true);
      return;
    }

    previousRumorNoticeIdRef.current = nextRumorNoticeId;
    setShowRumorModal(false);
    const timeoutId = window.setTimeout(() => {
      setShowRumorModal(true);
    }, 1000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [gameState.rumorNotice]);

  useEffect(() => {
    const nextPendingDetectiveId =
      gameState.pendingDetectiveGuess?.detectivePlayerId ?? null;
    const previousPendingDetectiveId = previousPendingActionPlayerIdRef.current;

    if (!nextPendingDetectiveId) {
      setShowPendingActionModal(false);
      previousPendingActionPlayerIdRef.current = null;
      return;
    }

    if (previousPendingDetectiveId === nextPendingDetectiveId) {
      setShowPendingActionModal(true);
      return;
    }

    previousPendingActionPlayerIdRef.current = nextPendingDetectiveId;
    setShowPendingActionModal(false);
    const timeoutId = window.setTimeout(() => {
      setShowPendingActionModal(true);
    }, 1000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [gameState.pendingDetectiveGuess]);

  useEffect(() => {
    const nextPendingDealPlayerId = gameState.pendingDeal?.dealPlayerId ?? null;
    const previousPendingDealPlayerId = previousPendingDealPlayerIdRef.current;

    if (!nextPendingDealPlayerId) {
      setShowPendingDealModal(false);
      previousPendingDealPlayerIdRef.current = null;
      return;
    }

    if (previousPendingDealPlayerId === nextPendingDealPlayerId) {
      setShowPendingDealModal(true);
      return;
    }

    previousPendingDealPlayerIdRef.current = nextPendingDealPlayerId;
    setShowPendingDealModal(false);
    const timeoutId = window.setTimeout(() => {
      setShowPendingDealModal(true);
    }, 1000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [gameState.pendingDeal]);

  useEffect(() => {
    const nextPendingEyewitnessPlayerId =
      gameState.pendingEyewitness?.eyewitnessPlayerId ?? null;
    const previousPendingEyewitnessPlayerId =
      previousPendingEyewitnessPlayerIdRef.current;

    if (!nextPendingEyewitnessPlayerId) {
      setShowPendingEyewitnessModal(false);
      previousPendingEyewitnessPlayerIdRef.current = null;
      return;
    }

    if (
      previousPendingEyewitnessPlayerId === nextPendingEyewitnessPlayerId &&
      gameState.pendingEyewitness.stage !== "target_selection"
    ) {
      setShowPendingEyewitnessModal(true);
      return;
    }

    if (
      previousPendingEyewitnessPlayerId === nextPendingEyewitnessPlayerId &&
      gameState.pendingEyewitness.stage === "target_selection"
    ) {
      setShowPendingEyewitnessModal(true);
      return;
    }

    previousPendingEyewitnessPlayerIdRef.current = nextPendingEyewitnessPlayerId;
    setShowPendingEyewitnessModal(false);
    const timeoutId = window.setTimeout(() => {
      setShowPendingEyewitnessModal(true);
    }, 1000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [gameState.pendingEyewitness]);

  const selectedCard = useMemo(
    () => visibleHand.find((card) => card.id === selectedCardId) ?? null,
    [visibleHand, selectedCardId]
  );

  const eligibleTargets = useMemo(
    () =>
      gameState.players.filter(
        (player) => !player.spectator && player.id !== playerId
      ),
    [gameState.players, playerId]
  );
  const pendingGuessTargets = useMemo(() => {
    const detectiveId = gameState.pendingDetectiveGuess?.detectivePlayerId;

    return gameState.players.filter(
      (player) => !player.spectator && player.id !== detectiveId
    );
  }, [gameState.pendingDetectiveGuess, gameState.players]);
  const pendingDealTargets = useMemo(() => {
    const dealPlayerId = gameState.pendingDeal?.dealPlayerId;

    return gameState.players.filter(
      (player) =>
        !player.spectator &&
        player.id !== dealPlayerId &&
        player.handCount > 0
    );
  }, [gameState.pendingDeal, gameState.players]);
  const pendingEyewitnessTargets = useMemo(() => {
    const eyewitnessPlayerId = gameState.pendingEyewitness?.eyewitnessPlayerId;

    return gameState.players.filter(
      (player) =>
        !player.spectator &&
        player.id !== eyewitnessPlayerId &&
        player.handCount > 0
    );
  }, [gameState.pendingEyewitness, gameState.players]);
  const canSelectDealCards =
    status === "Connected" &&
    gameState.pendingDeal?.waitingForExchange &&
    (gameState.pendingDeal.yourRole === "deal_player" ||
      gameState.pendingDeal.yourRole === "target_player");
  const hasSubmittedDealCard = Boolean(
    gameState.pendingDeal?.waitingForExchange &&
      gameState.pendingDeal?.yourSubmitted
  );
  const canSelectMediaCard = Boolean(
    status === "Connected" &&
      gameState.pendingMediaManipulation &&
      gameState.pendingMediaManipulation.canChooseCard
  );
  const hasSubmittedMediaCard = Boolean(
    gameState.pendingMediaManipulation?.yourSubmitted
  );

  const handCount = visibleHand.length;
  const selfPlayer =
    gameState.players.find((player) => player.id === playerId) ?? null;
  const showReconnectPrompt = Boolean(
    status === "Connected" &&
      gameState.phase === "playing" &&
      selfPlayer?.spectator &&
      gameState.disconnectedNotice &&
      !gameState.winner &&
      !gameState.gameError
  );
  const showDisconnectedWaitModal = Boolean(
    gameState.phase === "playing" &&
      gameState.disconnectedNotice &&
      !showReconnectPrompt &&
      !gameState.winner &&
      !gameState.gameError
  );
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
    !gameState.pendingDeal &&
    !gameState.pendingEyewitness &&
    !gameState.pendingMediaManipulation &&
    !gameState.disconnectedNotice &&
    !gameState.gameError &&
    !gameState.dealNotice &&
    !gameState.mediaManipulationNotice &&
    !gameState.rumorNotice &&
    !gameState.wrongGuessNotice;
  const canPlayCard =
    status === "Connected" &&
    gameState.phase === "playing" &&
    gameState.yourTurn &&
    Boolean(selectedCard) &&
    !gameState.pendingDetectiveGuess &&
    !gameState.pendingDeal &&
    !gameState.pendingEyewitness &&
    !gameState.pendingMediaManipulation &&
    !gameState.disconnectedNotice &&
    !gameState.gameError &&
    !gameState.dealNotice &&
    !gameState.mediaManipulationNotice &&
    !gameState.rumorNotice &&
    !gameState.wrongGuessNotice;
  const canSubmitEyewitnessTarget =
    status === "Connected" &&
    gameState.pendingEyewitness?.waitingForTarget &&
    gameState.pendingEyewitness?.yourRole === "eyewitness_player" &&
    Boolean(eyewitnessTargetId);
  const canSubmitDetectiveGuess =
    status === "Connected" &&
    gameState.pendingDetectiveGuess?.waitingForGuess &&
    Boolean(
      detectiveTargetId ||
        gameState.pendingDetectiveGuess?.selectedTargetPlayerId
    ) &&
    !gameState.wrongGuessNotice;
  const syncedDetectiveTargetId =
    gameState.pendingDetectiveGuess?.selectedTargetPlayerId ?? "";
  const effectiveDetectiveTargetId =
    detectiveTargetId || syncedDetectiveTargetId;
  const syncedEyewitnessTargetId =
    gameState.pendingEyewitness?.targetPlayerId ?? "";
  const canAttemptReconnect =
    status === "Connected" &&
    showReconnectPrompt &&
    nameInput.trim().length > 0;
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

    if (
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      (!canSaveName && !canAttemptReconnect)
    ) {
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
        targetPlayerId: effectiveDetectiveTargetId
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
    setDealTargetId("");
    setEyewitnessTargetId("");
    setSelectedDealCardId("");
    setSelectedMediaCardId("");
    setNotice("");
  };

  const handleDealTargetSelection = () => {
    const socket = socketRef.current;

    if (
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      !gameState.pendingDeal?.waitingForTarget ||
      gameState.pendingDeal.yourRole !== "deal_player" ||
      !dealTargetId
    ) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "deal_select_target",
        targetPlayerId: dealTargetId
      })
    );
    setNotice("");
  };

  const handleEyewitnessTargetSelection = () => {
    const socket = socketRef.current;

    if (
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      !canSubmitEyewitnessTarget
    ) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "eyewitness_select_target",
        targetPlayerId: eyewitnessTargetId
      })
    );
    setNotice("");
  };

  const handleEyewitnessTargetChange = (nextTargetPlayerId) => {
    setEyewitnessTargetId(nextTargetPlayerId);

    const socket = socketRef.current;

    if (
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      !gameState.pendingEyewitness?.waitingForTarget ||
      gameState.pendingEyewitness.yourRole !== "eyewitness_player"
    ) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "eyewitness_preview_target",
        targetPlayerId: nextTargetPlayerId
      })
    );
  };

  const handleEyewitnessRevealFinish = () => {
    const socket = socketRef.current;

    if (
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      !gameState.pendingEyewitness?.showingReveal ||
      gameState.pendingEyewitness.yourRole !== "eyewitness_player"
    ) {
      return;
    }

    socket.send(JSON.stringify({ type: "eyewitness_finish_reveal" }));
    setNotice("");
  };

  const handleDealTargetChange = (nextTargetPlayerId) => {
    setDealTargetId(nextTargetPlayerId);

    const socket = socketRef.current;

    if (
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      !gameState.pendingDeal?.waitingForTarget ||
      gameState.pendingDeal.yourRole !== "deal_player"
    ) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "deal_preview_target",
        targetPlayerId: nextTargetPlayerId
      })
    );
  };

  const handleDealCardSubmit = () => {
    const socket = socketRef.current;

    if (
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      !canSelectDealCards ||
      !selectedDealCardId
    ) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "deal_select_card",
        cardId: selectedDealCardId
      })
    );
    setNotice("");
  };

  const handleMediaCardSubmit = () => {
    const socket = socketRef.current;

    if (
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      !canSelectMediaCard ||
      !selectedMediaCardId ||
      hasSubmittedMediaCard
    ) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "media_manipulation_select_card",
        cardId: selectedMediaCardId
      })
    );
    setNotice("");
  };

  return (
    <main className="page-shell">
      <section className="hero">
        <button
          type="button"
          className="language-button"
          onClick={() => setLanguage((current) => (current === "en" ? "ja" : "en"))}
        >
          {t("languageLabel")}
        </button>
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1>{t("title")}</h1>
        <p className="subcopy">{t("subcopy")}</p>
      </section>

      <section
        className={`table-layout ${
          gameState.phase !== "playing" ? "is-lobby-layout" : ""
        }`}
      >
        <article className="panel players-panel">
          <div className="panel-header">
            <div>
              <span className="label">{t("table")}</span>
              <strong>{t("connected", { count: gameState.players.length })}</strong>
              {roomId && <p className="room-code">{t("roomCode", { roomId })}</p>}
            </div>
            {gameState.phase !== "playing" && (
              <button
                type="button"
                className="start-button"
                onClick={handleStartGame}
                disabled={!canPressStart}
              >
                {t("startGame")}
              </button>
            )}
          </div>

          {gameState.phase !== "playing" && (
            <div className="name-box">
              <label className="name-form">
                <span className="label">{t("yourName")}</span>
                <input
                  type="text"
                  maxLength={24}
                  value={nameInput}
                  onChange={(event) => setNameInput(event.target.value)}
                  disabled={gameState.phase === "playing"}
                  placeholder={t("enterName")}
                />
              </label>
              <div className="lobby-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleSaveName}
                  disabled={!canSaveName}
                >
                  {t("saveName")}
                </button>
              </div>
            </div>
          )}

          <div className="players-list">
            {gameState.players.map((player) => (
              <div
                key={player.id}
                className={`player-row ${
                  player.id === gameState.currentPlayerId ? "is-active" : ""
                } ${player.id === playerId ? "is-self" : ""} ${
                  player.connected === false ? "is-disconnected" : ""
                }`}
              >
                <div className="player-summary">
                  <strong>
                    {player.id === playerId
                      ? `${player.name}${t("youSuffix")}`
                      : player.name}
                  </strong>
                  {player.connected === false && <p>{t("disconnected")}</p>}
                  {player.isIntrigue && <p className="player-role-tag">{t("intrigue")}</p>}
                </div>
                {!player.spectator && (
                  <CardBackStack count={player.handCount} />
                )}
              </div>
            ))}
          </div>

          {notice && <div className="notice-box">{notice}</div>}
        </article>

        <div className="center-column">
          {gameState.phase === "playing" && (
            <>
              <article className="panel center-panel">
                <div className="panel-header">
                  <div>
                    <span className="label">{t("discardPile")}</span>
                  </div>
                </div>

                <div className="discard-card">
                  {gameState.discardPile.length > 0 ? (
                    <>
                      <div className="discard-meta">
                        <span className="label">{t("lastPlayedBy")}</span>
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
                      <span className="label">{t("tableState")}</span>
                      <strong>{t("noCardsPlayedYet")}</strong>
                      <p>{t("firstDiscovererHint")}</p>
                    </>
                  )}
                </div>
              </article>

              <article className="panel hand-panel">
                <div className="panel-header">
                  <div>
                    <span className="label">{t("yourHand")}</span>
                  </div>
                </div>

                <div className="hand-grid">
                  {visibleHand.map((card) => (
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
                  {t("playSelectedCard")}
                </button>
              </article>
            </>
          )}
        </div>
      </section>

      {gameState.pendingDetectiveGuess && showPendingActionModal && (
        <div className="modal-backdrop">
          <section className="detective-modal">
            <span className="label">{t("detectiveGuess")}</span>
            <img
              className="modal-card-image"
              src={detectiveCard}
              alt="Detective card"
            />
            <strong>
              {gameState.pendingDetectiveGuess.waitingForGuess
                ? t("detectiveChooseAccuse")
                : t("detectiveDeciding", {
                    name: gameState.pendingDetectiveGuess.detectiveName
                  })}
            </strong>
            <p>{t("detectiveDiscuss")}</p>

            <label className="target-picker">
              <span className="label">{t("suspectedCriminal")}</span>
              <select
                value={
                  gameState.pendingDetectiveGuess.waitingForGuess
                    ? effectiveDetectiveTargetId
                    : syncedDetectiveTargetId
                }
                onChange={(event) =>
                  handleDetectiveTargetChange(event.target.value)
                }
                disabled={!gameState.pendingDetectiveGuess.waitingForGuess}
              >
                <option value="">{t("choosePlayer")}</option>
                {pendingGuessTargets.map((player) => (
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
                {t("confirmDetectiveGuess")}
              </button>
            )}
          </section>
        </div>
      )}

      {gameState.pendingDeal && showPendingDealModal && (
        <div className="modal-backdrop">
          <section className="detective-modal">
            <span className="label">{t("deal")}</span>
            <img
              className="modal-card-image"
              src={dealCard}
              alt="Deal card"
            />

            {gameState.pendingDeal.waitingForTarget && (
              <>
                <strong>
                  {gameState.pendingDeal.yourRole === "deal_player"
                    ? t("chooseDealPlayer")
                    : t("dealChoosingPlayer", {
                        name: gameState.pendingDeal.dealPlayerName
                      })}
                </strong>
                <label className="target-picker">
                  <span className="label">{t("exchangePlayer")}</span>
                  <select
                    value={
                      gameState.pendingDeal.yourRole === "deal_player"
                        ? dealTargetId
                        : gameState.pendingDeal.targetPlayerId ?? ""
                    }
                    onChange={(event) =>
                      handleDealTargetChange(event.target.value)
                    }
                    disabled={gameState.pendingDeal.yourRole !== "deal_player"}
                  >
                    <option value="">{t("choosePlayer")}</option>
                    {pendingDealTargets.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.name}
                      </option>
                    ))}
                  </select>
                </label>
                {gameState.pendingDeal.yourRole === "deal_player" && (
                  <button
                    type="button"
                    className="play-button"
                    onClick={handleDealTargetSelection}
                    disabled={!dealTargetId}
                  >
                    {t("confirmDealPlayer")}
                  </button>
                )}
              </>
            )}

            {gameState.pendingDeal.waitingForExchange && (
              <>
                <strong>
                  {canSelectDealCards
                    ? t("chooseDealCardWith", {
                        name:
                          gameState.pendingDeal.yourRole === "deal_player"
                            ? gameState.pendingDeal.targetPlayerName
                            : gameState.pendingDeal.dealPlayerName
                      })
                    : t("dealPlayersChoosing", {
                        actorName: gameState.pendingDeal.dealPlayerName,
                        targetName: gameState.pendingDeal.targetPlayerName
                      })}
                </strong>
                {canSelectDealCards && (
                  <>
                    <div className="hand-grid modal-hand-grid">
                      {gameState.yourHand.map((card) => (
                        <button
                          key={card.id}
                          type="button"
                          className={`hand-card ${
                            !hasSubmittedDealCard ? "is-ready" : ""
                          } ${
                            selectedDealCardId === card.id ? "is-selected" : ""
                          }`}
                          disabled={hasSubmittedDealCard}
                          onClick={() => {
                            if (hasSubmittedDealCard) {
                              return;
                            }

                            setSelectedDealCardId(card.id);
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
                      onClick={handleDealCardSubmit}
                      disabled={!selectedDealCardId || hasSubmittedDealCard}
                    >
                      {t("confirmExchangeCard")}
                    </button>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {gameState.pendingEyewitness && showPendingEyewitnessModal && (
        <div className="modal-backdrop">
          <section className="detective-modal">
            <span className="label">{t("eyewitness")}</span>
            <img
              className="modal-card-image"
              src={eyewitnessCard}
              alt="Eyewitness card"
            />

            {gameState.pendingEyewitness.waitingForTarget && (
              <>
                <strong>
                  {gameState.pendingEyewitness.yourRole === "eyewitness_player"
                    ? t("chooseInspectPlayer")
                    : t("eyewitnessChoosing", {
                        name: gameState.pendingEyewitness.eyewitnessPlayerName
                      })}
                </strong>
                <label className="target-picker">
                  <span className="label">{t("inspectPlayer")}</span>
                  <select
                    value={
                      gameState.pendingEyewitness.yourRole ===
                      "eyewitness_player"
                        ? eyewitnessTargetId
                        : syncedEyewitnessTargetId
                    }
                    onChange={(event) =>
                      handleEyewitnessTargetChange(event.target.value)
                    }
                    disabled={
                      gameState.pendingEyewitness.yourRole !==
                      "eyewitness_player"
                    }
                  >
                    <option value="">{t("choosePlayer")}</option>
                    {pendingEyewitnessTargets.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.name}
                      </option>
                    ))}
                  </select>
                </label>
                {gameState.pendingEyewitness.yourRole === "eyewitness_player" && (
                  <button
                    type="button"
                    className="play-button"
                    onClick={handleEyewitnessTargetSelection}
                    disabled={!canSubmitEyewitnessTarget}
                  >
                    {t("confirmEyewitnessTarget")}
                  </button>
                )}
              </>
            )}

            {gameState.pendingEyewitness.showingReveal && (
              <>
                <strong>
                  {gameState.pendingEyewitness.yourRole === "eyewitness_player"
                    ? t("lookingAtHand", {
                        targetName: gameState.pendingEyewitness.targetPlayerName
                      })
                    : t("eyewitnessLookingAtHand", {
                        actorName: gameState.pendingEyewitness.eyewitnessPlayerName,
                        targetName: gameState.pendingEyewitness.targetPlayerName
                      })}
                </strong>
                {gameState.pendingEyewitness.yourRole === "eyewitness_player" ? (
                  <>
                    <div className="hand-grid modal-hand-grid reveal-hand-grid">
                      {gameState.pendingEyewitness.targetHand.map((card) => (
                        <div key={card.id} className="reveal-card">
                          <img
                            className="hand-card-image"
                            src={CARD_IMAGES[card.type]}
                            alt={card.type}
                          />
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="play-button"
                      onClick={handleEyewitnessRevealFinish}
                    >
                      {t("endReveal")}
                    </button>
                  </>
                ) : (
                  <p>{t("waitingEyewitness")}</p>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {gameState.pendingMediaManipulation && showPendingMediaModal && (
        <div className="modal-backdrop">
          <section className="detective-modal">
            <span className="label">{t("mediaManipulation")}</span>
            <img
              className="modal-card-image"
              src={mediaManipulationCard}
              alt="Media Manipulation card"
            />
            <strong>
              {canSelectMediaCard
                ? t("choosePassCard")
                : t("mediaManipulationPlayed", {
                    name: gameState.pendingMediaManipulation.actorName
                  })}
            </strong>
            <p>{t("mediaManipulationExplain")}</p>
            {canSelectMediaCard && (
              <>
                <div className="hand-grid modal-hand-grid">
                  {gameState.yourHand.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      className={`hand-card ${
                        !hasSubmittedMediaCard ? "is-ready" : ""
                      } ${
                        selectedMediaCardId === card.id ? "is-selected" : ""
                      }`}
                      disabled={hasSubmittedMediaCard}
                      onClick={() => {
                        if (hasSubmittedMediaCard) {
                          return;
                        }

                        setSelectedMediaCardId(card.id);
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
                  onClick={handleMediaCardSubmit}
                  disabled={!selectedMediaCardId || hasSubmittedMediaCard}
                >
                  {t("confirmPassCard")}
                </button>
              </>
            )}
          </section>
        </div>
      )}

      {showReconnectPrompt && (
        <div className="modal-backdrop">
          <section className="detective-modal detective-result-modal">
            <span className="label">{t("reconnect")}</span>
            <strong>{t("reconnectTitle")}</strong>
            <p>{t("reconnectDescription")}</p>
            <label className="target-picker">
              <span className="label">{t("playerName")}</span>
              <input
                type="text"
                maxLength={24}
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
                placeholder={t("enterSameName")}
              />
            </label>
            <button
              type="button"
              className="play-button"
              onClick={handleSaveName}
              disabled={!canAttemptReconnect}
            >
              {t("rejoinGame")}
            </button>
          </section>
        </div>
      )}

      {showDisconnectedWaitModal && (
        <div className="modal-backdrop">
          <section className="detective-modal detective-result-modal">
            <span className="label">{t("connection")}</span>
            <strong>{translateMessage(gameState.disconnectedNotice)}</strong>
          </section>
        </div>
      )}

      {gameState.wrongGuessNotice && (
        <div className="modal-backdrop">
          <section className="detective-modal detective-result-modal">
            <span className="label">{t("detectiveResult")}</span>
            <img
              className="modal-card-image"
              src={detectiveCard}
              alt="Detective card"
            />
            <strong>{translateMessage(gameState.wrongGuessNotice)}</strong>
          </section>
        </div>
      )}

      {gameState.gameError && (
        <div className="modal-backdrop">
          <section className="detective-modal detective-result-modal result-loss">
            <span className="label error-popup-label">{t("error")}</span>
            <strong>{translateMessage(gameState.gameError)}</strong>
            <button
              type="button"
              className="play-button modal-action-button"
              onClick={handleReturnToLobby}
            >
              {t("backToLobby")}
            </button>
          </section>
        </div>
      )}

      {gameState.dealNotice && showDealResultModal && (
        <div className="modal-backdrop">
          <section className="detective-modal detective-result-modal">
            <span className="label">{t("deal")}</span>
            <img
              className="modal-card-image"
              src={dealCard}
              alt="Deal card"
            />
            {gameState.dealNotice.givenCardType ||
            gameState.dealNotice.receivedCardType ? (
              <>
                <strong>
                  {t("dealPlayed", { name: gameState.dealNotice.actorName })}
                </strong>
                <div className="rumor-exchange-row">
                  <img className="rumor-arrow-image" src={arrowLeftImage} alt="" />
                  <div className="rumor-card-slot">
                    <span className="label">
                      {t("gaveTo", { name: gameState.dealNotice.nextPlayerName })}
                    </span>
                    {gameState.dealNotice.givenCardType ? (
                      <img
                        className="rumor-card-image"
                        src={CARD_IMAGES[gameState.dealNotice.givenCardType]}
                        alt={gameState.dealNotice.givenCardType}
                      />
                    ) : (
                      <strong>{t("noCard")}</strong>
                    )}
                  </div>
                  <div className="rumor-card-slot">
                    <span className="label">
                      {t("receivedFrom", {
                        name: gameState.dealNotice.previousPlayerName
                      })}
                    </span>
                    {gameState.dealNotice.receivedCardType ? (
                      <img
                        className="rumor-card-image"
                        src={CARD_IMAGES[gameState.dealNotice.receivedCardType]}
                        alt={gameState.dealNotice.receivedCardType}
                      />
                    ) : (
                      <strong>{t("noCard")}</strong>
                    )}
                  </div>
                  <img className="rumor-arrow-image" src={arrowLeftImage} alt="" />
                </div>
              </>
            ) : (
              <strong>
                {t("dealPlayersChoosing", {
                  actorName: gameState.dealNotice.actorName,
                  targetName: gameState.dealNotice.targetPlayerName
                })}
              </strong>
            )}
          </section>
        </div>
      )}

      {gameState.mediaManipulationNotice && showMediaResultModal && (
        <div className="modal-backdrop">
          <section className="detective-modal detective-result-modal">
            <span className="label">{t("mediaManipulation")}</span>
            <img
              className="modal-card-image"
              src={mediaManipulationCard}
              alt="Media Manipulation card"
            />
            <strong>
              {t("mediaManipulationPlayed", {
                name: gameState.mediaManipulationNotice.actorName
              })}
            </strong>
            <div className="rumor-exchange-row">
              <img className="rumor-arrow-image" src={arrowLeftImage} alt="" />
              <div className="rumor-card-slot">
                <span className="label">
                  {t("gaveTo", {
                    name: gameState.mediaManipulationNotice.nextPlayerName
                  })}
                </span>
                {gameState.mediaManipulationNotice.givenCardType ? (
                  <img
                    className="rumor-card-image"
                    src={
                      CARD_IMAGES[
                        gameState.mediaManipulationNotice.givenCardType
                      ]
                    }
                    alt={gameState.mediaManipulationNotice.givenCardType}
                  />
                ) : (
                  <strong>{t("noCard")}</strong>
                )}
              </div>
              <div className="rumor-card-slot">
                <span className="label">
                  {t("receivedFrom", {
                    name: gameState.mediaManipulationNotice.previousPlayerName
                  })}
                </span>
                {gameState.mediaManipulationNotice.receivedCardType ? (
                  <img
                    className="rumor-card-image"
                    src={
                      CARD_IMAGES[
                        gameState.mediaManipulationNotice.receivedCardType
                      ]
                    }
                    alt={gameState.mediaManipulationNotice.receivedCardType}
                  />
                ) : (
                  <strong>{t("noCard")}</strong>
                )}
              </div>
              <img className="rumor-arrow-image" src={arrowLeftImage} alt="" />
            </div>
          </section>
        </div>
      )}

      {gameState.rumorNotice && showRumorModal && (
        <div className="modal-backdrop">
          <section className="detective-modal detective-result-modal">
            <span className="label">Rumor</span>
            <img
              className="modal-card-image"
              src={rumorCard}
              alt="Rumor card"
            />
            <strong>{t("rumorPlayed", { name: gameState.rumorNotice.actorName })}</strong>
            <div className="rumor-exchange-row">
              <img className="rumor-arrow-image" src={arrowLeftImage} alt="" />
              <div className="rumor-card-slot">
                <span className="label">
                  {t("gaveTo", { name: gameState.rumorNotice.nextPlayerName })}
                </span>
                {gameState.rumorNotice.givenCardType ? (
                  <img
                    className="rumor-card-image"
                    src={CARD_IMAGES[gameState.rumorNotice.givenCardType]}
                    alt={gameState.rumorNotice.givenCardType}
                  />
                ) : (
                  <strong>{t("noCard")}</strong>
                )}
              </div>
              <div className="rumor-card-slot">
                <span className="label">
                  {t("receivedFrom", {
                    name: gameState.rumorNotice.previousPlayerName
                  })}
                </span>
                {gameState.rumorNotice.receivedCardType ? (
                  <img
                    className="rumor-card-image"
                    src={CARD_IMAGES[gameState.rumorNotice.receivedCardType]}
                    alt={gameState.rumorNotice.receivedCardType}
                  />
                ) : (
                  <strong>{t("noCard")}</strong>
                )}
              </div>
              <img className="rumor-arrow-image" src={arrowLeftImage} alt="" />
            </div>
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
            <span className="label result-popup-label">{t("result")}</span>
            <h2 className="result-heading">
              {didCurrentPlayerWin ? t("youWon") : t("youLost")}
            </h2>
            {(gameState.winner.reason === "criminal_played" ||
              gameState.winner.reason === "detective_guess") && (
              <img
                className="modal-card-image"
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
            <strong>{translateMessage(gameState.winner)}</strong>
            <button
              type="button"
              className="play-button modal-action-button"
              onClick={handleReturnToLobby}
            >
              {t("backToLobby")}
            </button>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
