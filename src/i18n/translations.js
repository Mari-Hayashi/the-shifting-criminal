export const translations = {
  en: {
    languageLabel: "日本語",
    eyebrow: "Deduction Card Game Prototype",
    title: "The Shifting Culprit",
    subcopy:
      "Wait for at least three players, then press Stat Game. Your hand is private, but every played card is revealed to the whole table.",
    table: "Table",
    connected: ({ count }) => `${count} connected`,
    roomCode: ({ roomId }) => `Room ${roomId}`,
    disconnectedWaitingSingle: ({ playerName }) =>
      `${playerName} is disconnected. Waiting for ${playerName} to rejoin...`,
    disconnectedWaitingMultiple: ({ otherNames, lastName }) =>
      `${otherNames} and ${lastName} are disconnected. Waiting for them to rejoin...`,
    gameTerminatedDisconnection: ({ playerName }) =>
      `The game has been terminated because ${playerName} did not rejoin within 3 minutes.`,
    criminalPlayedWin: ({ playerName }) =>
      `${playerName} played the Criminal card as their last card and wins.`,
    detectiveIdentifiedCriminal: ({ detectiveName, targetName }) =>
      `${detectiveName} identified ${targetName} as the Criminal.`,
    detectiveGuessIncorrect: ({ targetName }) =>
      `A Detective guessed ${targetName} as a Criminal but it was incorrect.`,
    criminalLastCardRule:
      "The Criminal card can only be played when it is your last remaining card.",
    detectiveFirstRoundRule:
      "The Detective card cannot be played during the first round.",
    option: "Option",
    save: "Save",
    cancel: "Cancel",
    initialCardCount: "Initial Card Count",
    useRandomSetOfCards: "Use Random Set of Cards",
    initialCardCountWholeNumber: "Initial card count must be a whole number.",
    initialCardCountTooSmall: ({ min }) =>
      `Initial card count must be at least ${min}.`,
    initialCardCountTooLarge: ({ max }) =>
      `Initial card count cannot be greater than ${max} for the current player count.`,
    initialCardCountLimit: ({ max }) => `Use a value from 4 to ${max}.`,
    startGame: "Start Game",
    yourName: "Your Name",
    enterName: "Enter your name",
    saveName: "Save Name",
    youSuffix: " (You)",
    disconnected: "Disconnected",
    discardPile: "Discard Pile",
    tableState: "Table state",
    noCardsPlayedYet: "No cards have been played yet.",
    firstDiscovererHint:
      "Whoever holds the First Discoverer card goes first and must play it during the first round.",
    lastPlayedBy: "Last played by",
    yourHand: "Your Hand",
    playSelectedCard: "Play Selected Card",
    detectiveGuess: "Detective Guess",
    intrigue: "Intrigue",
    detectiveChooseAccuse: "Choose who you want to accuse.",
    detectiveDeciding: ({ name }) => `${name} is deciding who to accuse.`,
    detectiveDiscuss:
      "The Detective card has been played. Take a moment to discuss before the accusation is locked in.",
    suspectedCriminal: "Suspected Criminal",
    choosePlayer: "Choose a player",
    confirmDetectiveGuess: "Confirm Detective Guess",
    deal: "Deal",
    chooseDealPlayer: "Choose a player to exchange with.",
    dealChoosingPlayer: ({ name }) =>
      `${name} is choosing a player to exchange with.`,
    exchangePlayer: "Exchange Player",
    confirmDealPlayer: "Confirm Deal Player",
    chooseDealCardWith: ({ name }) =>
      `Choose one card to exchange with ${name}.`,
    dealPlayersChoosing: ({ actorName, targetName }) =>
      `${actorName} and ${targetName} are choosing cards to exchange.`,
    confirmExchangeCard: "Confirm Exchange Card",
    boy: "Boy",
    boyCheckingCriminal: "You are checking who has the Criminal card.",
    boyWaitingObserver: ({ actorName }) =>
      `${actorName} is checking who has the Criminal card.`,
    boyRevealCriminalHolder: ({ playerName }) =>
      `${playerName} has the Criminal card.`,
    boyRevealNoCriminal: "No one has the Criminal card in this game.",
    boyWaitingOthers: "Please wait while Boy checks who has the Criminal card.",
    close: "Close",
    eyewitness: "Eyewitness",
    chooseInspectPlayer: "Choose a player whose hand you want to inspect.",
    eyewitnessChoosing: ({ name }) =>
      `${name} is choosing whose hand to inspect.`,
    inspectPlayer: "Inspect Player",
    confirmEyewitnessTarget: "Confirm Eyewitness Target",
    lookingAtHand: ({ targetName }) => `You are looking at ${targetName}'s hand.`,
    eyewitnessLookingAtHand: ({ actorName, targetName }) =>
      `${actorName} is looking at ${targetName}'s hand.`,
    waitingEyewitness: "Please wait while the Eyewitness privately checks those cards.",
    endReveal: "End Reveal",
    mediaManipulation: "Media Manipulation",
    choosePassCard: "Choose one card to pass to the next player.",
    mediaManipulationPlayed: ({ name }) => `${name} played Media Manipulation.`,
    mediaManipulationExplain:
      "Everyone chooses one card to give to the next player. If you have no cards, you will only receive.",
    confirmPassCard: "Confirm Pass Card",
    reconnect: "Reconnect",
    reconnectTitle: "Rejoin the game with the same name.",
    reconnectDescription:
      "There is an existing game going on. If you were part of the game and wish to rejoin the game, please enter the same name you have used before to reclaim that seat.",
    playerName: "Player Name",
    enterSameName: "Enter the same name",
    rejoinGame: "Rejoin Game",
    connection: "Connection",
    detectiveResult: "Detective Result",
    dealPlayed: ({ name }) => `${name} played Deal.`,
    rumorPlayed: ({ name }) => `${name} played Rumor.`,
    gaveTo: ({ name }) => `Gave To ${name}`,
    receivedFrom: ({ name }) => `Received From ${name}`,
    noCard: "No card",
    error: "Error",
    result: "Result",
    youWon: "YOU WON",
    youLost: "YOU LOST",
    backToLobby: "Back to Lobby"
  },
  ja: {
    languageLabel: "English",
    eyebrow: "犯人は今日、この場所に集まった私たちの中にいます。",
    title: "犯人は踊る",
    subcopy:
      "3人以上集まったら「開始」を押してください。",
    table: "テーブル",
    connected: ({ count }) => `${count}人が接続中`,
    roomCode: ({ roomId }) => `ルームID ${roomId}`,
    disconnectedWaitingSingle: ({ playerName }) =>
      `${playerName} が切断されました。再参加を待っています。`,
    disconnectedWaitingMultiple: ({ otherNames, lastName }) =>
      `${otherNames} と ${lastName} が切断されました。再参加を待っています。`,
    gameTerminatedDisconnection: ({ playerName }) =>
      `${playerName} が3分以内に再参加しなかったため、ゲームは終了しました。`,
    criminalPlayedWin: ({ playerName }) =>
      `${playerName} が犯人カードを出し、勝利しました。`,
    detectiveIdentifiedCriminal: ({ detectiveName, targetName }) =>
      `${detectiveName} は ${targetName} が犯人だと見抜きました。`,
    detectiveGuessIncorrect: ({ targetName }) =>
      `探偵は ${targetName} を犯人だと推理しましたが、外れでした。`,
    criminalLastCardRule:
      "犯人カードは手札の最後の1枚のときにしか出せません。",
    detectiveFirstRoundRule:
      "探偵カードは二週目になるまでは使えません。",
    option: "オプション",
    save: "保存",
    cancel: "キャンセル",
    initialCardCount: "最初のカードの枚数",
    useRandomSetOfCards: "必須カードを無効にする",
    initialCardCountWholeNumber: "最初のカードの枚数は整数で入力してください。",
    initialCardCountTooSmall: ({ min }) =>
      `最初のカードの枚数は ${min} 以上にしてください。`,
    initialCardCountTooLarge: ({ max }) =>
      `最初のカードの枚数は現在の人数では ${max} 以下にしてください。`,
    initialCardCountLimit: ({ max }) => `4 から ${max} の間で入力してください。`,
    startGame: "開始",
    yourName: "プレイヤー名",
    enterName: "名前を入力",
    saveName: "名前を保存",
    youSuffix: "（あなた）",
    disconnected: "切断中",
    discardPile: "場のカード",
    tableState: "テーブルの状態",
    noCardsPlayedYet: "まだカードはプレイされていません。",
    firstDiscovererHint:
      "第一発見者カードを持っている人は第一発見者カードを出しましょう。",
    lastPlayedBy: "カードを出した人",
    yourHand: "あなたの手札",
    playSelectedCard: "カードを出す",
    detectiveGuess: "探偵の推理",
    intrigue: "たくらみ中",
    detectiveChooseAccuse: "犯人だと思う相手を選んでください。",
    detectiveDeciding: ({ name }) => `探偵 ${name} が犯人を推理しています。`,
    detectiveDiscuss: "探偵カードが出されました。",
    suspectedCriminal: "犯人だと思う人",
    choosePlayer: "プレイヤーを選択",
    confirmDetectiveGuess: "推理を確定",
    deal: "取り引き",
    chooseDealPlayer: "カードを交換する相手を選んでください。",
    dealChoosingPlayer: ({ name }) => `${name} が交換相手を選んでいます。`,
    exchangePlayer: "交換相手",
    confirmDealPlayer: "決定",
    chooseDealCardWith: ({ name }) => `${name} と交換するカードを1枚選んでください。`,
    dealPlayersChoosing: ({ actorName, targetName }) =>
      `${actorName} と ${targetName} が交換するカードを選んでいます。`,
    confirmExchangeCard: "決定",
    boy: "少年",
    boyCheckingCriminal: "犯人カードを持っている人を確認しています。",
    boyWaitingObserver: ({ actorName }) =>
      `${actorName} が犯人カードを持っている人を確認しています。`,
    boyRevealCriminalHolder: ({ playerName }) =>
      `${playerName} が犯人カードを持っています。`,
    boyRevealNoCriminal: "このゲームでは誰も犯人カードを持っていません。",
    boyWaitingOthers: "少年が犯人カードを持っている人を確認しています。少し待ってください。",
    close: "閉じる",
    eyewitness: "目撃者",
    chooseInspectPlayer: "誰の手札を見ますか？",
    eyewitnessChoosing: ({ name }) => `${name} が手札を見る人を選んでいます。`,
    inspectPlayer: "手札を見る人",
    confirmEyewitnessTarget: "決定",
    lookingAtHand: ({ targetName }) => `${targetName} の手札を見ています。`,
    eyewitnessLookingAtHand: ({ actorName, targetName }) =>
      `${actorName} が ${targetName} の手札を見ています。`,
    waitingEyewitness: "目撃者が手札を確認している間、しばらくお待ちください。",
    endReveal: "確認を終了",
    mediaManipulation: "情報操作",
    choosePassCard: "次のプレイヤーに渡すカードを1枚選んでください。",
    mediaManipulationPlayed: ({ name }) => `${name} が情報操作のカードを出しました。`,
    mediaManipulationExplain:
      "全員、次のプレイヤーに手札の一枚をこっそり渡します。。手札がない場合は渡せません。",
    confirmPassCard: "決定",
    reconnect: "再参加",
    reconnectTitle: "ゲームに戻りますか？",
    reconnectDescription:
      "現在進行中のゲームがあります。以前このゲームに参加していた場合は、前回と同じ名前を入力すれば再参加できます。",
    playerName: "プレイヤー名",
    enterSameName: "名前",
    rejoinGame: "再参加",
    connection: "接続",
    detectiveResult: "推理結果",
    dealPlayed: ({ name }) => `${name} が取引を出しました。`,
    rumorPlayed: ({ name }) => `${name} がうわさを出しました。`,
    gaveTo: ({ name }) => `${name} へ`,
    receivedFrom: ({ name }) => `${name} から`,
    noCard: "無し",
    error: "エラー",
    result: "結果",
    youWon: "YOU WON",
    youLost: "YOU LOST",
    backToLobby: "ロビーに戻る"
  }
};

export function translate(language, key, params = {}) {
  const table = translations[language] ?? translations.en;
  const fallback = translations.en[key];
  const value = table[key] ?? fallback;

  if (typeof value === "function") {
    return value(params);
  }

  return value ?? key;
}
