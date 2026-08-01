import { useEffect, useState } from "react";

const FINAL_STAGES = ["success", "failed"];

export default function MindWithWordsGame({
  game,
  playerId,
  socketRef,
  t,
  setNotice,
  onReturnToLobby
}) {
  const [topicInput, setTopicInput] = useState("");
  const [answerInput, setAnswerInput] = useState("");

  useEffect(() => {
    if (!game) {
      setTopicInput("");
      setAnswerInput("");
      return;
    }

    setTopicInput((current) => current || game.topic || "");
    setAnswerInput((current) => current || game.yourAnswer || "");
  }, [game]);

  const sendAction = (payload) => {
    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify(payload));
    setNotice("");
  };

  const handleTopicSubmit = () => {
    const topic = topicInput.trim();

    if (topic.length < 3) {
      setNotice(t("mindTopicRequired"));
      return;
    }

    sendAction({ type: "mind_set_topic", topic });
  };

  const handleAnswerSubmit = () => {
    const answer = answerInput.trim();

    if (!answer) {
      setNotice(t("mindAnswerRequired"));
      return;
    }

    sendAction({ type: "mind_submit_answer", answer });
  };

  const handleReveal = () => {
    sendAction({ type: "mind_reveal_card" });
  };

  const finalStage = FINAL_STAGES.includes(game?.stage);
  const resultPlayers = finalStage
    ? [...game.players].sort(
        (leftPlayer, rightPlayer) =>
          leftPlayer.revealedNumber - rightPlayer.revealedNumber
      )
    : game?.players ?? [];
  const self = game?.players.find((player) => player.id === playerId);

  return (
    <article className="panel mind-game-panel">
      <span className="label">{t("nowPlaying")}</span>
      <h2>{t("mindWithWordsTitle")}</h2>

      {game?.stage === "topic" && (
        <div className="mind-stage">
          <p>{t("mindChooseTopicHelp")}</p>
          <label className="mind-field">
            <span className="label">{t("mindTopic")}</span>
            <input
              type="text"
              maxLength={120}
              value={topicInput}
              onChange={(event) => setTopicInput(event.target.value)}
              placeholder={t("mindTopicPlaceholder")}
            />
          </label>
          <button
            type="button"
            className="play-button"
            onClick={handleTopicSubmit}
            disabled={topicInput.trim().length < 3}
          >
            {t("mindConfirmTopic")}
          </button>
        </div>
      )}

      {game?.stage === "answers" && (
        <div className="mind-stage">
          <TopicBanner topic={game.topic} t={t} />
          <div className="mind-number-card" aria-label={t("mindYourNumber")}>
            <span>{t("mindYourNumber")}</span>
            <strong>{game.yourNumber}</strong>
          </div>
          {game.yourAnswerSubmitted ? (
            <div className="mind-waiting">
              <strong>{t("mindAnswerLocked")}</strong>
              <p>{game.yourAnswer}</p>
              <span>{t("mindWaitingAnswers")}</span>
            </div>
          ) : (
            <>
              <p>{t("mindAnswerHelp")}</p>
              <label className="mind-field">
                <span className="label">{t("mindYourAnswer")}</span>
                <input
                  type="text"
                  maxLength={120}
                  value={answerInput}
                  onChange={(event) => setAnswerInput(event.target.value)}
                  placeholder={t("mindAnswerPlaceholder")}
                />
              </label>
              <button
                type="button"
                className="play-button"
                onClick={handleAnswerSubmit}
                disabled={!answerInput.trim()}
              >
                {t("mindLockAnswer")}
              </button>
            </>
          )}
          <div className="mind-progress">
            {game.players.map((player) => (
              <span
                key={player.id}
                className={player.answerSubmitted ? "is-done" : ""}
              >
                {player.name} {player.answerSubmitted ? "✓" : "…"}
              </span>
            ))}
          </div>
          <div className="mind-answer-list">
            {game.players
              .filter((player) => player.answerSubmitted)
              .map((player) => (
                <AnswerRow key={player.id} player={player} />
              ))}
          </div>
        </div>
      )}

      {["discussion", ...FINAL_STAGES].includes(game?.stage) && (
        <div className="mind-stage">
          <TopicBanner topic={game.topic} t={t} />
          {game.stage === "discussion" && (
            <>
              <p>{t("mindDiscussHelp")}</p>
              {game.hadMistake && (
                <div className="mind-result is-warning">
                  <strong>{t("mindContinueTitle")}</strong>
                  <span>{t("mindContinueCopy")}</span>
                </div>
              )}
            </>
          )}
          {game.stage === "success" && (
            <div className="mind-result is-success">
              <strong>{t("mindSuccessTitle")}</strong>
              <span>{t("mindSuccessCopy")}</span>
            </div>
          )}
          {game.stage === "failed" && (
            <div className="mind-result is-failed">
              <strong>{t("mindFailedTitle")}</strong>
              <span>{t("mindFailedCopy")}</span>
            </div>
          )}
          <div className="mind-answer-list">
            {resultPlayers.map((player) => (
              <AnswerRow key={player.id} player={player} showNumber />
            ))}
          </div>
          {game.stage === "discussion" && !self?.revealedNumber && (
            <div className="mind-reveal-action">
              <span>{t("mindYourSecretNumber", { number: game.yourNumber })}</span>
              <button type="button" className="play-button" onClick={handleReveal}>
                {t("mindRevealCard")}
              </button>
            </div>
          )}
        </div>
      )}

      {finalStage && (
        <button
          type="button"
          className="secondary-button"
          onClick={onReturnToLobby}
        >
          {t("backToLobby")}
        </button>
      )}
    </article>
  );
}

function TopicBanner({ topic, t }) {
  return (
    <div className="mind-topic-banner">
      <span className="label">{t("mindTopic")}</span>
      <strong>{topic}</strong>
    </div>
  );
}

function AnswerRow({ player, showNumber = false }) {
  return (
    <div className="mind-answer-row">
      <div>
        <span className="label">{player.name}</span>
        <strong>{player.answer}</strong>
      </div>
      {showNumber && player.revealedNumber !== null && (
        <span
          className={`mind-revealed-number ${
            player.revealCorrect === true
              ? "is-correct"
              : player.revealCorrect === false
                ? "is-wrong"
                : ""
          }`}
        >
          {player.revealedNumber}
        </span>
      )}
    </div>
  );
}
