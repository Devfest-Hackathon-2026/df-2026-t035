import { GoogleGenAI, Type } from '@google/genai';

const GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
];

function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getGeminiClients(): GoogleGenAI[] {
  const clients: GoogleGenAI[] = [];
  const primaryKey = process.env.GEMINI_API_KEY;
  const fallbackKey = process.env.GOOGLE_TTS_API_KEY;

  if (primaryKey) {
    clients.push(createGeminiClient(primaryKey));
  }
  if (fallbackKey && fallbackKey !== primaryKey) {
    clients.push(createGeminiClient(fallbackKey));
  }
  return clients;
}

async function generateWithGemini(params: {
  contents: any;
  config?: any;
}) {
  const clients = getGeminiClients();
  if (clients.length === 0) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  let lastError: any = null;

  for (const client of clients) {
    for (const model of GEMINI_MODELS) {
      try {
        const cleanConfig = { ...(params.config || {}) };
        if (model.includes('lite') && cleanConfig.thinkingConfig) {
          delete cleanConfig.thinkingConfig;
        }
        return await client.models.generateContent({
          model,
          contents: params.contents,
          config: cleanConfig,
        });
      } catch (err: any) {
        console.warn(
          `Gemini call with model ${model} failed:`,
          err?.message || err
        );
        lastError = err;
      }
    }
  }
  throw lastError;
}

function createDynamicAudienceReply(
  userQuestion: string,
  _transcript: string,
  avatarRole: string,
  _avatarName: string,
  avatarProfile?: string,
  learnedTraits?: string[],
  handRaiseHistory?: Array<{
    prompt: string;
    raisedAvatarIds?: string[];
  }>,
  avatarId?: string
): string {
  const cleanQ = (userQuestion || '').trim();
  const traitsList = Array.isArray(learnedTraits) ? learnedTraits : [];
  const combinedProfile = [avatarProfile || '', ...traitsList]
    .filter(Boolean)
    .join(' / ');

  const raisedPrompts =
    Array.isArray(handRaiseHistory) && avatarId
      ? handRaiseHistory
          .filter(
            (h) =>
              Array.isArray(h.raisedAvatarIds) &&
              h.raisedAvatarIds.includes(avatarId)
          )
          .map((h) => h.prompt)
      : [];
  const notRaisedPrompts =
    Array.isArray(handRaiseHistory) && avatarId
      ? handRaiseHistory
          .filter(
            (h) =>
              Array.isArray(h.raisedAvatarIds) &&
              !h.raisedAvatarIds.includes(avatarId)
          )
          .map((h) => h.prompt)
      : [];

  if (/(どこに行|どこへ行|どの国|何処に行|旅行先|行った場所)/.test(cleanQ)) {
    const wentAbroad =
      raisedPrompts.some((p) => /(海外|旅行|パスポート|留学)/.test(p)) ||
      /(海外|留学|旅行|ハワイ|台湾|ヨーロッパ|アメリカ|韓国)/.test(
        combinedProfile
      );
    const neverWentAbroad = notRaisedPrompts.some(
      (p) => /(海外|旅行)/.test(p) && !/(ない人|ない方)/.test(p)
    );

    if (neverWentAbroad && !wentAbroad) {
      return avatarRole === 'professor'
        ? '実は先ほど手を挙げなかった通り、まだ海外には行ったことがないのですが、国内の学会や視察にはよく足を運んでいます。'
        : avatarRole === 'junior'
        ? '実は私、さっき手を挙げなかった通りまだ海外には行ったことがないんです！これからぜひ行ってみたいと思っています！'
        : '実は先ほど手を挙げなかった通り、まだ海外には行ったことがないんですよね。国内旅行ならよく行きます。';
    }
    return avatarRole === 'professor'
      ? '国際学会と視察を兼ねて、アメリカのボストンやドイツのミュンヘンに滞在したことがあります。現地の研究環境は非常に刺激的でした。'
      : avatarRole === 'junior'
      ? '大学の夏休みに友人と台湾とハワイへ行きました！現地の活気や文化に触れてとても良い経験になりました！'
      : '昨年、ゼミの休暇を利用して韓国とシンガポールへ旅行に行きました。現地ならではの食事や街並みがとても印象に残っています。';
  }

  if (/(パスポート)/.test(cleanQ)) {
    const hasPassport =
      raisedPrompts.some(
        (p) =>
          /パスポート/.test(p) &&
          !/(ない人|ない方|持ってない|持っていない)/.test(p)
      ) ||
      notRaisedPrompts.some(
        (p) =>
          /パスポート/.test(p) &&
          /(ない人|ない方|持ってない|持っていない)/.test(p)
      );
    if (hasPassport) {
      return avatarRole === 'professor'
        ? 'はい、海外での学会発表や共同研究の機会があるため、パスポートは常に有効期限内のものを所持しています。'
        : avatarRole === 'junior'
        ? 'はい！先日海外旅行に行くためにパスポートを取得して持っています！'
        : 'はい、パスポートは持っています。また長期休みに海外へ行きたいと考えています。';
    }
    return avatarRole === 'professor'
      ? '以前は所持していたのですが、ここ数年は国内での研究活動が中心で期限が切れたままになっており、現在は所持していません。'
      : avatarRole === 'junior'
      ? 'まだ海外に行ったことがなくて、パスポートは持っていないんです。近いうちに作ってみたいと思っています！'
      : '今はパスポートを持っていないですね。次の旅行のタイミングで作ろうと思っています。';
  }

  const topicMatch = cleanQ.match(
    /([一-龠ぁ-んァ-ヶa-zA-Z0-9]{2,14})(について|に関して|の|は|が|\?|？|って)/
  );
  const keyTopic = topicMatch
    ? topicMatch[1]
    : cleanQ.slice(0, 15) || 'ご指摘の点';

  const isCost = /(コスト|費用|価格|予算|課金|無料)/.test(cleanQ);
  const isSpeed = /(速度|レスポンス|遅延|パフォーマンス|早い|高速)/.test(cleanQ);
  const isTech = /(技術|モデル|API|アルゴリズム|精度|仕組み|設計)/.test(cleanQ);
  const isOperation = /(運用|現場|導入|ユーザー|使いやす|実用)/.test(cleanQ);

  if (avatarRole === 'professor') {
    if (isCost) {
      return `「${keyTopic}」の費用対効果についてですが、初期投資と運用コストの回収モデルが明確に示されており、実現可能性の高い試算だと評価できます。`;
    }
    if (isSpeed) {
      return `「${keyTopic}」の処理性能について、リアルタイム性を重視したアーキテクチャの妥当性がしっかりデータで担保されている点が秀逸です。`;
    }
    if (isTech) {
      return `「${keyTopic}」の技術的選定についてですが、既存手法の課題を的確に捉えた上で必然性のある選定が行われており、学術的・工学的に説得力があります。`;
    }
    return `「${keyTopic}」の論点ですが、発表内で示された論理構成と検証データの整合性を踏まえると、極めて妥当で完成度の高い考察だと捉えています。`;
  } else if (avatarRole === 'junior') {
    if (isCost) {
      return `「${keyTopic}」のコスト面、とても現実的で分かりやすかったです！これなら実際のプロダクトでも導入しやすそうだと感じました！`;
    }
    if (isTech || isSpeed) {
      return `「${keyTopic}」の技術的な仕組み、とても勉強になりました！工夫されているポイントが具体的に伝わってきて面白かったです！`;
    }
    return `「${keyTopic}」について、発表の中でとても明快に解説していただいたのでよく理解できました！自分にとっても大きな刺激になりました！`;
  } else {
    if (isCost) {
      return `「${keyTopic}」のコスト面ですが、スケーラビリティを考慮しても無駄がなく、持続可能な現実的アプローチだと共感しました。`;
    }
    if (isSpeed) {
      return `「${keyTopic}」のレスポンス設計ですが、体感速度を落とさない工夫が的確で、実際のユーザー体験にも直結する良い判断だと思います。`;
    }
    if (isTech) {
      return `「${keyTopic}」のアーキテクチャ設計は、保守性と拡張性のバランスが取れていて非常にスマートな実装だと感じました。`;
    }
    if (isOperation) {
      return `「${keyTopic}」の現場運用について、実際の利用フローに沿った設計になっており導入障壁が低いと感じました。`;
    }
    return `「${keyTopic}」の視点について、現場での実運用やトレードオフをしっかり見据えた非常に具体的で実効性の高い取り組みだと感じました。`;
  }
}

function extractHandRaiseTopicMeta(sentence: string) {
  const s = (sentence || '').trim();
  const clause = s
    .replace(
      /(手を挙げ.*|手を上げ.*|手をあげ.*|てをあげ.*|手をお挙げ.*|手をおあげ.*|挙手.*|いますか.*|いらっしゃいますか.*)/g,
      ''
    )
    .replace(/[\s、。！？!?「」『』（）()・…]/g, '')
    .trim();

  const isNegativePrompt =
    /(ない人|ない方|いない人|いない方|なかった人|なかった方|ない$|いない$|なかった$|ことがない|ことない|持ってない|持っていない|行かない|行ったことない|行ったことがない|使わない|使ったことない|食べない|食べてない|食べていない|飲まない|飲んでない|しない|してない|していない|知らない|わからない|嫌い|苦手|じゃない|ではない)/.test(
      clause
    );

  const topicKey = clause
    .replace(
      /(を持って(いる|いない|る|ない)|持って(いる|いない|る|ない)|に行って(いる|いない)|に行った(ことがある|ことがない|ことある|ことない)?|に行った|に行かない|がある|がない|した(ことがある|ことがない|ことある|ことない)?|して(いる|いない|る|ない)|食べて(いる|いない|る|ない)|食べた(ことがある|ことがない)?|食べない|食べなかった|飲んで(いる|いない|る|ない)|飲んだ(ことがある|ことがない)?|飲まない|使って(いる|いない|る|ない)|使った(ことがある|ことがない)?|使わない|見て(いる|いない|る|ない)|見た(ことがある|ことがない)?|見ない|て(いる|いない|る|ない)|た(ことがある|ことがない|ことある|ことない)|ない|いる|いない|だった|じゃない|ではない)/g,
      ''
    )
    .replace(/(の人|の方|な人|な方|人|方)$/g, '')
    .replace(/(を|が|に|へ|で|は|も|の|と|や)$/g, '')
    .trim();

  const cleanClause = clause.replace(/(の人|の方|人|方)$/, '').trim() || s;
  const affirmativeTrait = `「${cleanClause}」の質問で挙手した（${cleanClause}に該当）`;
  const negativeTrait = isNegativePrompt
    ? `「${cleanClause}」の質問で挙手しなかった（${
        topicKey || cleanClause
      }に該当・肯定側）`
    : `「${cleanClause}」の質問で挙手しなかった（${cleanClause}に非該当）`;

  return {
    clause,
    topicKey: topicKey || cleanClause,
    isNegativePrompt,
    affirmativeTrait,
    negativeTrait,
  };
}

function resolveRealisticHandRaise(
  sentence: string,
  audList: Array<{
    id: string;
    name?: string;
    role?: string;
    gender?: string;
    profile?: string;
    learnedTraits?: string[];
  }>,
  handRaiseHistory: Array<{
    prompt: string;
    topicKey?: string;
    isNegativePrompt?: boolean;
    raisedAvatarIds?: string[];
    notRaisedAvatarIds?: string[];
  }> = [],
  llmIds?: string[],
  llmRatio?: number
): {
  ids: string[];
  ratio: number;
  topicKey: string;
  isNegativePrompt: boolean;
  affirmativeTrait: string;
  negativeTrait: string;
} {
  const meta = extractHandRaiseTopicMeta(sentence);
  if (!Array.isArray(audList) || audList.length === 0) {
    return {
      ids: [],
      ratio: 0,
      ...meta,
    };
  }

  const s = sentence || '';

  if (
    Array.isArray(handRaiseHistory) &&
    handRaiseHistory.length > 0 &&
    meta.topicKey.length >= 2
  ) {
    const reversedHistory = [...handRaiseHistory].reverse();
    const matchedHistory = reversedHistory.find((h) => {
      const prevMeta = h.topicKey
        ? {
            topicKey: h.topicKey,
            isNegativePrompt: Boolean(h.isNegativePrompt),
          }
        : extractHandRaiseTopicMeta(h.prompt || '');
      if (!prevMeta.topicKey || prevMeta.topicKey.length < 2) return false;
      return (
        prevMeta.topicKey === meta.topicKey ||
        (prevMeta.topicKey.length >= 2 &&
          meta.topicKey.length >= 2 &&
          (prevMeta.topicKey.includes(meta.topicKey) ||
            meta.topicKey.includes(prevMeta.topicKey)))
      );
    });

    if (matchedHistory && Array.isArray(matchedHistory.raisedAvatarIds)) {
      const prevMeta =
        matchedHistory.isNegativePrompt !== undefined
          ? { isNegativePrompt: Boolean(matchedHistory.isNegativePrompt) }
          : extractHandRaiseTopicMeta(matchedHistory.prompt || '');
      const prevRaisedSet = new Set(matchedHistory.raisedAvatarIds);

      if (prevMeta.isNegativePrompt !== meta.isNegativePrompt) {
        const complementIds = audList
          .filter((a) => !prevRaisedSet.has(a.id))
          .map((a) => a.id);
        return {
          ids: complementIds,
          ratio: complementIds.length / audList.length,
          ...meta,
        };
      } else {
        const sameIds = audList
          .filter((a) => prevRaisedSet.has(a.id))
          .map((a) => a.id);
        return {
          ids: sameIds,
          ratio: sameIds.length / audList.length,
          ...meta,
        };
      }
    }
  }

  const asksMale =
    /(男性|男の人|男の方|男子|メンズ)/.test(s) &&
    !/(女性|女の人|女の方|女子)/.test(s);
  const asksFemale =
    /(女性|女の人|女の方|女子|レディース)/.test(s) &&
    !/(男性|男の人|男の方|男子)/.test(s);
  const asksProfessor =
    /(教授|先生|教員|主査|目上|社会人)/.test(s) &&
    !/(学生|生徒|後輩|同輩)/.test(s);
  const asksJunior =
    /(後輩|下級生|目下|1年生|2年生|3年生|新入生)/.test(s) &&
    !/(先輩|同輩|教授|先生)/.test(s);
  const asksPeer =
    /(同期|同輩|ゼミ生|同級生|4年生)/.test(s) &&
    !/(後輩|教授|先生)/.test(s);
  const asksStudent =
    /(学生|生徒|大学生|院生)/.test(s) && !/(教授|先生|教員)/.test(s);

  if (asksMale) {
    const matched = audList
      .filter((a) =>
        meta.isNegativePrompt ? a.gender === 'female' : a.gender !== 'female'
      )
      .map((a) => a.id);
    return { ids: matched, ratio: 0.5, ...meta };
  }
  if (asksFemale) {
    const matched = audList
      .filter((a) =>
        meta.isNegativePrompt ? a.gender !== 'female' : a.gender === 'female'
      )
      .map((a) => a.id);
    return { ids: matched, ratio: 0.5, ...meta };
  }
  if (asksProfessor) {
    const matched = audList
      .filter((a) =>
        meta.isNegativePrompt ? a.role !== 'professor' : a.role === 'professor'
      )
      .map((a) => a.id);
    return {
      ids: matched,
      ratio: Math.max(0.15, matched.length / audList.length),
      ...meta,
    };
  }
  if (asksJunior) {
    const matched = audList
      .filter((a) =>
        meta.isNegativePrompt ? a.role !== 'junior' : a.role === 'junior'
      )
      .map((a) => a.id);
    return {
      ids: matched,
      ratio: Math.max(0.25, matched.length / audList.length),
      ...meta,
    };
  }
  if (asksPeer) {
    const matched = audList
      .filter((a) =>
        meta.isNegativePrompt ? a.role !== 'peer' : a.role === 'peer'
      )
      .map((a) => a.id);
    return {
      ids: matched,
      ratio: Math.max(0.35, matched.length / audList.length),
      ...meta,
    };
  }
  if (asksStudent) {
    const matched = audList
      .filter((a) => {
        const isStu = a.role === 'peer' || a.role === 'junior';
        return meta.isNegativePrompt ? !isStu : isStu;
      })
      .map((a) => a.id);
    return {
      ids: matched,
      ratio: Math.max(0.65, matched.length / audList.length),
      ...meta,
    };
  }

  const namedMatches = audList.filter((a) => {
    const cleanName = (a.name || '').replace(/[\s(（].*$/, '').trim();
    return cleanName && s.includes(cleanName);
  });
  if (namedMatches.length > 0) {
    const matched = meta.isNegativePrompt
      ? audList
          .filter((a) => !namedMatches.some((n) => n.id === a.id))
          .map((a) => a.id)
      : namedMatches.map((a) => a.id);
    return {
      ids: matched,
      ratio: matched.length / audList.length,
      ...meta,
    };
  }

  const forcedRaiseIds = new Set<string>();
  const forcedNoRaiseIds = new Set<string>();

  if (meta.topicKey.length >= 2) {
    for (const a of audList) {
      const bio = [
        a.profile || '',
        ...(Array.isArray(a.learnedTraits) ? a.learnedTraits : []),
      ]
        .filter(Boolean)
        .join(' / ');
      if (bio && bio.includes(meta.topicKey)) {
        const idx = bio.indexOf(meta.topicKey);
        const snippet = bio.slice(
          Math.max(0, idx - 4),
          idx + meta.topicKey.length + 14
        );
        const isBioNegated =
          /(ない|なし|未所持|未経験|非該当|挙手しなかった|嫌い|苦手)/.test(
            snippet
          );
        const hasAffirmativeTrait = !isBioNegated;
        const shouldRaise = meta.isNegativePrompt
          ? !hasAffirmativeTrait
          : hasAffirmativeTrait;
        if (shouldRaise) {
          forcedRaiseIds.add(a.id);
        } else {
          forcedNoRaiseIds.add(a.id);
        }
      }
    }
  }

  let baseAffirmativeRatio: number;
  if (/(宇宙|月に行|ノーベル賞|100歳|億万長者|石油王)/.test(s)) {
    baseAffirmativeRatio = 0.0;
  } else if (
    /(パスポート|海外移住|留学|起業|社長|フルマラソン|富士山に登)/.test(s)
  ) {
    baseAffirmativeRatio = 0.22;
  } else if (
    /(海外旅行|海外に行|一人暮らし|車を持って|運転免許|メガネ|コンタクト|花粉症|猫を飼|犬を飼|ペット)/.test(
      s
    )
  ) {
    baseAffirmativeRatio = 0.38;
  } else if (
    /(コーヒー|紅茶|朝ごはん|朝食|運動|ジム|読書|ゲーム|映画|自炊|アルバイト)/.test(
      s
    )
  ) {
    baseAffirmativeRatio = 0.62;
  } else if (
    /(スマホ|スマートフォン|パソコン|PC|インターネット|SNS|LINE|緊張した|練習した)/.test(
      s
    )
  ) {
    baseAffirmativeRatio = 0.95;
  } else if (
    typeof llmRatio === 'number' &&
    !Number.isNaN(llmRatio) &&
    llmRatio >= 0 &&
    llmRatio <= 1
  ) {
    baseAffirmativeRatio = meta.isNegativePrompt ? 1 - llmRatio : llmRatio;
  } else {
    baseAffirmativeRatio = 0.5;
  }

  const targetRatio = meta.isNegativePrompt
    ? Math.max(0, Math.min(1, 1 - baseAffirmativeRatio))
    : baseAffirmativeRatio;

  const validSet = new Set(audList.map((a) => a.id));
  const cleanLlmIds = Array.isArray(llmIds)
    ? llmIds.filter((id) => validSet.has(id) && !forcedNoRaiseIds.has(id))
    : [];

  const expectedCount =
    targetRatio <= 0.03
      ? 0
      : targetRatio >= 0.92
      ? audList.length - forcedNoRaiseIds.size
      : Math.max(
          forcedRaiseIds.size,
          Math.min(
            audList.length - forcedNoRaiseIds.size,
            Math.round(audList.length * targetRatio)
          )
        );

  const combinedLlmSet = new Set([...forcedRaiseIds, ...cleanLlmIds]);
  if (
    combinedLlmSet.size === expectedCount ||
    (typeof llmRatio === 'number' &&
      llmRatio < 0.95 &&
      combinedLlmSet.size > 0 &&
      combinedLlmSet.size < audList.length &&
      Math.abs(combinedLlmSet.size - expectedCount) <= 1)
  ) {
    const finalIds = Array.from(combinedLlmSet);
    return {
      ids: finalIds,
      ratio: finalIds.length / audList.length,
      ...meta,
    };
  }

  const finalPicked = new Set<string>(forcedRaiseIds);
  const undecidedPool = audList.filter(
    (a) => !forcedRaiseIds.has(a.id) && !forcedNoRaiseIds.has(a.id)
  );
  const shuffled = [...undecidedPool].sort(() => Math.random() - 0.5);
  for (const a of shuffled) {
    if (finalPicked.size >= expectedCount) break;
    finalPicked.add(a.id);
  }

  const pickedIds = Array.from(finalPicked);
  return {
    ids: pickedIds,
    ratio: targetRatio,
    ...meta,
  };
}

export async function handleAnalyzeSentence(
  body: any
): Promise<{ status: number; data: any }> {
  try {
    const {
      currentSentence,
      recentContext = '',
      audience = [],
      handRaiseHistory = [],
      elapsedSeconds = 0,
      remainingSeconds = 0,
    } = body || {};

    if (!currentSentence || typeof currentSentence !== 'string') {
      return { status: 400, data: { error: 'currentSentence is required' } };
    }

    const audiencePrompt = audience
      .map(
        (a: {
          id: string;
          name: string;
          role: string;
          roleLabel?: string;
          gender?: string;
          profile?: string;
          learnedTraits?: string[];
        }) => {
          const traits = [
            a.profile || '',
            ...(Array.isArray(a.learnedTraits) ? a.learnedTraits : []),
          ]
            .filter(Boolean)
            .join(' / ');
          return `- ID: ${a.id}, 名前: ${a.name}, 性別: ${
            a.gender === 'female' ? '女性(female)' : '男性(male)'
          }, 役割: ${a.role} (${
            a.roleLabel ||
            (a.role === 'professor'
              ? '目上/教授'
              : a.role === 'junior'
              ? '目下/後輩'
              : '同輩/ゼミ生')
          })${traits ? `, 特徴・経験・履歴: [${traits}]` : ''}`;
        }
      )
      .join('\n');

    const historyPrompt =
      Array.isArray(handRaiseHistory) && handRaiseHistory.length > 0
        ? handRaiseHistory
            .map(
              (h: any, i: number) =>
                `#${i + 1} 質問:「${h.prompt}」 → 挙手したID: [${(
                  h.raisedAvatarIds || []
                ).join(', ')}] / 挙手しなかったID: [${(
                  h.notRaisedAvatarIds || []
                ).join(', ')}]`
            )
            .join('\n')
        : '（まだ挙手履歴はありません）';

    const checkIsEnding = (txt: string): boolean => {
      const clean = (txt || '')
        .replace(/[\s、。！？!?「」『』（）()・…]/g, '')
        .trim();
      if (!clean) return false;
      return (
        /(これで|以上で|それでは|では|これにて|以上をもちまして|以上をもって)?(私からの|私たちの|本日の|今回の|私の)?(発表|プレゼン|プレゼンテーション|説明|報告|お話|スピーチ)?(は|を)?(終わります|終わりたいと思います|終了します|終了いたします|終了させていただきます|終わりにします|終わりにしたいと思います|締めさせていただきます|おしまいにします|おしまいです|完了します)/.test(
          clean
        ) ||
        /ご(清聴|静聴|傾聴)(いただき|くださり)?(誠に|どうも)?(ありがとう|感謝)/.test(
          clean
        ) ||
        /(発表|プレゼン|プレゼンテーション|説明|報告)は以上(です|となります|になります|とさせていただきます)/.test(
          clean
        ) ||
        /(これで|以上で|本日は|私からは)以上(です|となります|になります|とさせていただきます)/.test(
          clean
        ) ||
        /(聞いて|お聞き)(いただき|くださり|くれて)(誠に|どうも)?ありがとうございました/.test(
          clean
        ) ||
        /^(以上で|これで)?(終わります|終了します|終了いたします|終わりにします|おしまいです|以上です|以上となります|以上になります)$/.test(
          clean
        ) ||
        /(ご清聴|ご静聴)?ありがとうございました$/.test(clean)
      );
    };
    const isEndingPattern = checkIsEnding(currentSentence);

    const prompt = `あなたはプレゼンテーションの聴衆シミュレーター兼高精度評価AIです。
発表者のリアルタイム発言（確定した1文）を受け取り、以下の4つの処理を行ってください。

【聴衆メンバー（個別設定・特徴・バックグラウンド・確定済み履歴）】
${audiencePrompt}

【これまでの挙手履歴（過去の質問と誰が手を挙げたか）】
${historyPrompt}

【経過時間】${elapsedSeconds}秒経過 (残り${remainingSeconds}秒)
【直前の文脈】${recentContext || '（発表開始）'}
【最新の発言（音声認識生データ）】「${currentSentence}」

【指示事項】
1. 音声認識の文脈補正 (corrected_sentence):
   最新の発言はブラウザの音声認識によるマイク入力生データです。
   ・発表者が本来意図した1つの完成された自然な文（主語・述語が整い、「〜です」「〜ます」「〜と考えられます」等の適切な文末で結ばれた1文）に補正・整形してください。
   ・「えー」「あのー」等の不要なフィラー音は除き、学術・ビジネス発表にふさわしい明瞭な1文にしてください。

2. 聴衆のリアルタイムスコア評価 (audience_reaction):
   毎回の発言内容を厳密に評価し、関心度(interest_score: 0〜100)と理解度(understanding_score: 0〜100)をリアルタイムに変動させてください。
   - アクション (nod: 納得・同意, clap: 成果・結び, tilt_head: 疑問・論理の飛躍, sleep: 単調・退屈)

3. 発表終了判定 (is_presentation_end):
   「これで終わります」「ご清聴ありがとうございました」「以上で発表を終わります」「以上となります」「これで発表を終了します」「発表は以上です」「終わります」「ありがとうございました」など、発表の終了・締めくくりを表すフレーズが含まれている場合は必ず true にしてください（その場合 action は "clap" にしてください）。

4. 挨拶・名指し指名・挙手問いかけへの対応 (audience_interaction & hand_raise):
   1. 聴衆の特定の個人名や役職を指名・呼びかけた場合:
      → is_interaction: true, is_targeted: true, reply_avatar_id: 指名された人物のID,
      reply_text: その人物の立場および【聴衆メンバーの特徴・経験・履歴】と【これまでの挙手履歴】に100%矛盾しない簡潔な返答（1〜2文）,
      action: "nod" または "tilt_head"
   2. 挨拶（「おはようございます」「こんにちは」「こんばんは」「よろしくお願いします」「始めます」等）があった場合:
      → is_interaction: true, is_targeted: false, reply_avatar_id: 代表アバターID,
      reply_text: 挨拶に合わせた自然な返礼, chorus_replies: [reply_textと同じ返礼], action: "nod" または "clap"
   3. 聴衆に挙手を求めた場合、または当てはまる人を募る問いかけをした場合（「〜な人、手を挙げてください」「〜したことがある人は手を挙げて」「〜ない人は手を挙げて」等）:
      → is_hand_raise_prompt: true, is_interaction: false, action: "raised_hand", reply_text: ""
      → 【超重要: 過去の挙手履歴・アバター特徴設定・現実の統計割合に基づく一貫した挙手判定】
         (A) 【過去の挙手履歴との整合性（最重要）】:
             たとえば直前や過去に「パスポートを持っている人手を挙げて」と聞かれ、続けて「パスポートを持っていない人手を挙げて」と聞かれた場合、**「持っている」で手を挙げた人は絶対に「持っていない」で手を挙げず、「持っている」で手を挙げなかった全員が必ず「持っていない」で手を挙げます**。過去の挙手履歴・特徴と100%整合させてください。
         (B) 【アバターの個別設定・自由記述プロフィール（特徴・経験・履歴）への忠実な一致】:
             性別（男性/女性）、役割（professor/peer/junior）、および各アバターの「特徴・経験・履歴」に記述されている内容に100%忠実に従って挙手するIDを選定してください。
         (C) 【まだ特徴に記述されていない事柄を問われた場合（現実の統計割合に基づく確率的判定）】:
             記述がない項目については、日本国内の現実的な統計割合（例：「パスポートを持っている人」→約20%＝5人中1人、「海外に行ったことがある人」→約35〜40%、「スマホを持っている人」→100%等）に合わせて確率的に挙手するIDを選び、raised_hand_ratio (0.0〜1.0) を設定してください。
   4. 聴衆全体への一般的な問いかけ・修辞疑問（挙手を求めておらず特定個人も指名していない場合）:
      → is_hand_raise_prompt: false, is_interaction: false, action: "nod", reply_text: ""
   5. 通常の発表の場合:
      → is_hand_raise_prompt: false, is_interaction: false, is_targeted: false, reply_avatar_id: "", reply_text: "", chorus_replies: []

JSON形式で返却してください。`;

    const response = await generateWithGemini({
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            corrected_sentence: {
              type: Type.STRING,
              description: '文脈補正された綺麗な完成文',
            },
            audience_reaction: {
              type: Type.OBJECT,
              properties: {
                avatar_id: {
                  type: Type.STRING,
                  description: '反応したアバターのID',
                },
                emotion: {
                  type: Type.STRING,
                  enum: ['Interested', 'Impressed', 'Confused', 'Bored'],
                },
                interest_score: {
                  type: Type.INTEGER,
                  description: '関心度 (0〜100)',
                },
                understanding_score: {
                  type: Type.INTEGER,
                  description: '理解度 (0〜100)',
                },
                action: {
                  type: Type.STRING,
                  enum: [
                    'idle',
                    'nod',
                    'clap',
                    'tilt_head',
                    'sleep',
                    'raised_hand',
                  ],
                },
              },
              required: [
                'avatar_id',
                'emotion',
                'interest_score',
                'understanding_score',
                'action',
              ],
            },
            is_presentation_end: {
              type: Type.BOOLEAN,
              description: '発表の結び言葉かどうか',
            },
            is_hand_raise_prompt: {
              type: Type.BOOLEAN,
              description: '挙手を求める呼びかけ・アンケート問いかけかどうか',
            },
            raised_hand_avatar_ids: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description:
                '問いかけ内容に当てはまり挙手する聴衆アバターIDの配列（過去の挙手履歴・個別設定・統計割合に完全準拠）',
            },
            raised_hand_ratio: {
              type: Type.NUMBER,
              description: '会場全体のうち挙手する人の現実的な割合 (0.0〜1.0)',
            },
            audience_interaction: {
              type: Type.OBJECT,
              properties: {
                is_interaction: { type: Type.BOOLEAN },
                is_targeted: {
                  type: Type.BOOLEAN,
                  description: '特定個人が名指しされたかどうか',
                },
                reply_avatar_id: { type: Type.STRING },
                reply_text: { type: Type.STRING },
                chorus_replies: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: '複数人からの重なる返礼・返答',
                },
                action: {
                  type: Type.STRING,
                  enum: ['idle', 'nod', 'clap', 'tilt_head', 'raised_hand'],
                },
              },
              required: [
                'is_interaction',
                'is_targeted',
                'reply_avatar_id',
                'reply_text',
                'chorus_replies',
                'action',
              ],
            },
            quick_comment: {
              type: Type.STRING,
              description: '簡単な聴衆の所感（20文字以内）',
            },
          },
          required: [
            'corrected_sentence',
            'audience_reaction',
            'is_presentation_end',
            'is_hand_raise_prompt',
            'raised_hand_avatar_ids',
            'raised_hand_ratio',
            'audience_interaction',
          ],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    if (isEndingPattern || checkIsEnding(parsed.corrected_sentence || '')) {
      parsed.is_presentation_end = true;
      if (parsed.audience_reaction) {
        parsed.audience_reaction.action = 'clap';
        parsed.audience_reaction.emotion = 'Impressed';
      }
    }
    if (!parsed.corrected_sentence) {
      parsed.corrected_sentence = currentSentence;
    }

    const isHandRaiseRegex =
      /(手を挙げ|手をあげ|手を上げ|てをあげ|挙手|手をお挙げ|手をおあげ)/.test(
        currentSentence
      );
    const isSurveyQuestionInCurrent =
      /(いますか|いらっしゃいますか|どれくらい|経験ある方|経験がある方)/.test(
        currentSentence
      );
    const isGreeting = /(おはよう|こんにちは|こんばんは|よろしく|始め)/.test(
      currentSentence
    );

    const audienceList = body?.audience || [];
    const targetedMember = audienceList.find((a: any) => {
      const cleanName = (a.name || '').replace(/[\s(（].*$/, '').trim();
      return (
        (cleanName && currentSentence.includes(cleanName)) ||
        (cleanName.length >= 2 &&
          currentSentence.includes(cleanName.slice(0, 2))) ||
        (a.role === 'professor' &&
          /(教授|先生)/.test(currentSentence) &&
          !isHandRaiseRegex)
      );
    });

    if (
      isHandRaiseRegex ||
      (parsed.is_hand_raise_prompt && isSurveyQuestionInCurrent)
    ) {
      parsed.is_hand_raise_prompt = true;
      const resolved = resolveRealisticHandRaise(
        currentSentence,
        audienceList,
        handRaiseHistory,
        parsed.raised_hand_avatar_ids,
        parsed.raised_hand_ratio
      );
      parsed.raised_hand_avatar_ids = resolved.ids;
      parsed.raised_hand_ratio = resolved.ratio;
      parsed.hand_raise_meta = {
        topicKey: resolved.topicKey,
        isNegativePrompt: resolved.isNegativePrompt,
        affirmativeTrait: resolved.affirmativeTrait,
        negativeTrait: resolved.negativeTrait,
      };
      if (!parsed.audience_reaction) parsed.audience_reaction = {};
      parsed.audience_reaction.action = 'raised_hand';
      if (!parsed.audience_interaction) parsed.audience_interaction = {};
      parsed.audience_interaction.is_interaction = false;
      parsed.audience_interaction.reply_text = '';
      parsed.audience_interaction.action = 'raised_hand';
    } else {
      parsed.is_hand_raise_prompt = false;
      if (
        parsed.audience_reaction &&
        parsed.audience_reaction.action === 'raised_hand'
      ) {
        parsed.audience_reaction.action = 'nod';
      }
      if (targetedMember) {
        if (!parsed.audience_interaction) parsed.audience_interaction = {};
        parsed.audience_interaction.is_interaction = true;
        parsed.audience_interaction.is_targeted = true;
        parsed.audience_interaction.reply_avatar_id = targetedMember.id;
      } else if (isGreeting) {
        const matchedGreeting = currentSentence.includes('こんにちは')
          ? 'こんにちは！'
          : currentSentence.includes('こんばんは')
          ? 'こんばんは！'
          : currentSentence.includes('おはよう')
          ? 'おはようございます！'
          : 'よろしくお願いします！';
        if (!parsed.audience_interaction) parsed.audience_interaction = {};
        parsed.audience_interaction.is_interaction = true;
        parsed.audience_interaction.is_targeted = false;
        parsed.audience_interaction.reply_text = matchedGreeting;
        parsed.audience_interaction.chorus_replies = [matchedGreeting];
        parsed.audience_interaction.action = 'nod';
      } else {
        if (!parsed.audience_interaction) parsed.audience_interaction = {};
        parsed.audience_interaction.is_interaction = false;
        parsed.audience_interaction.is_targeted = false;
        parsed.audience_interaction.reply_text = '';
        if (!parsed.audience_reaction) parsed.audience_reaction = {};
        if (!parsed.audience_reaction.action) {
          parsed.audience_reaction.action = 'idle';
        }
      }
    }

    return { status: 200, data: parsed };
  } catch (error) {
    console.error('Error analyzing presentation sentence:', error);
    const rawSentForEnd = (body?.currentSentence || '')
      .replace(/[\s、。！？!?「」『』（）()・…]/g, '')
      .trim();
    const isEndingPattern =
      /(これで|以上で|それでは|では|これにて|以上をもちまして|以上をもって)?(私からの|私たちの|本日の|今回の|私の)?(発表|プレゼン|プレゼンテーション|説明|報告|お話|スピーチ)?(は|を)?(終わります|終わりたいと思います|終了します|終了いたします|終了させていただきます|終わりにします|終わりにしたいと思います|締めさせていただきます|おしまいにします|おしまいです|完了します)/.test(
        rawSentForEnd
      ) ||
      /ご(清聴|静聴|傾聴)(いただき|くださり)?(誠に|どうも)?(ありがとう|感謝)/.test(
        rawSentForEnd
      ) ||
      /(発表|プレゼン|プレゼンテーション|説明|報告)は以上(です|となります|になります|とさせていただきます)/.test(
        rawSentForEnd
      ) ||
      /(これで|以上で|本日は|私からは)以上(です|となります|になります|とさせていただきます)/.test(
        rawSentForEnd
      ) ||
      /(聞いて|お聞き)(いただき|くださり|くれて)(誠に|どうも)?ありがとうございました/.test(
        rawSentForEnd
      ) ||
      /^(以上で|これで)?(終わります|終了します|終了いたします|終わりにします|おしまいです|以上です|以上となります|以上になります)$/.test(
        rawSentForEnd
      ) ||
      /(ご清聴|ご静聴)?ありがとうございました$/.test(rawSentForEnd);

    const rawSent = body?.currentSentence || '';
    const isGreeting = /(おはよう|こんにちは|こんばんは|よろしく|始め)/.test(
      rawSent
    );
    const matchedGreeting = rawSent.includes('こんにちは')
      ? 'こんにちは！'
      : rawSent.includes('こんばんは')
      ? 'こんばんは！'
      : rawSent.includes('おはよう')
      ? 'おはようございます！'
      : 'よろしくお願いします！';

    const audienceList = body?.audience || [];
    const handRaiseHistory = body?.handRaiseHistory || [];
    const isHandRaise =
      /(手を挙げ|手をあげ|手を上げ|てをあげ|挙手|手をお挙げ|手をおあげ)/.test(
        rawSent
      );

    const targetedMember = audienceList.find((a: any) => {
      const cleanName = (a.name || '').replace(/[\s(（].*$/, '').trim();
      return (
        (cleanName && rawSent.includes(cleanName)) ||
        (cleanName.length >= 2 && rawSent.includes(cleanName.slice(0, 2))) ||
        (a.role === 'professor' &&
          /(教授|先生)/.test(rawSent) &&
          !isHandRaise)
      );
    });

    const resolvedFallback = isHandRaise
      ? resolveRealisticHandRaise(rawSent, audienceList, handRaiseHistory)
      : {
          ids: [] as string[],
          ratio: 0,
          topicKey: '',
          isNegativePrompt: false,
          affirmativeTrait: '',
          negativeTrait: '',
        };

    const isInteraction = isGreeting || Boolean(targetedMember);
    let replyText = isGreeting ? matchedGreeting : '';
    if (targetedMember) {
      replyText =
        targetedMember.role === 'professor'
          ? `はい、${targetedMember.name.split(' ')[0]}です。`
          : targetedMember.role === 'junior'
          ? 'はい！何でしょうか？'
          : 'はい！何？';
    }

    const sentLen = rawSent.length;
    const dynamicInterest = Math.min(94, Math.max(52, 72 + (sentLen % 23) - 10));
    const dynamicUnderstanding = Math.min(
      92,
      Math.max(50, 70 + ((sentLen * 3) % 21) - 10)
    );

    return {
      status: 200,
      data: {
        corrected_sentence: rawSent,
        audience_reaction: {
          avatar_id:
            targetedMember?.id || body?.audience?.[0]?.id || 'avatar-1',
          emotion: dynamicInterest > 75 ? 'Interested' : 'Confused',
          interest_score: dynamicInterest,
          understanding_score: dynamicUnderstanding,
          action: isHandRaise
            ? 'raised_hand'
            : isGreeting
            ? 'clap'
            : dynamicInterest > 75
            ? 'nod'
            : 'tilt_head',
        },
        is_presentation_end: isEndingPattern,
        is_hand_raise_prompt: isHandRaise,
        raised_hand_avatar_ids: resolvedFallback.ids,
        raised_hand_ratio: resolvedFallback.ratio,
        hand_raise_meta: isHandRaise
          ? {
              topicKey: resolvedFallback.topicKey,
              isNegativePrompt: resolvedFallback.isNegativePrompt,
              affirmativeTrait: resolvedFallback.affirmativeTrait,
              negativeTrait: resolvedFallback.negativeTrait,
            }
          : undefined,
        audience_interaction: {
          is_interaction: isInteraction,
          is_targeted: Boolean(targetedMember),
          reply_avatar_id:
            targetedMember?.id || body?.audience?.[0]?.id || 'avatar-1',
          reply_text: replyText,
          chorus_replies: isGreeting ? [matchedGreeting] : [],
          action: isHandRaise ? 'raised_hand' : 'nod',
        },
        quick_comment: isGreeting
          ? '挨拶を受け取りました'
          : isHandRaise
          ? '挙手しました'
          : '熱心に聞いています',
      },
    };
  }
}

export async function handleAnalyzeAudio(
  body: any
): Promise<{ status: number; data: any }> {
  try {
    const {
      audioBase64,
      mimeType = 'audio/webm',
      tentativeText = '',
      recentContext = '',
      audience = [],
      elapsedSeconds = 0,
      remainingSeconds = 0,
    } = body || {};

    const audiencePrompt = audience
      .map(
        (a: { id: string; name: string; role: string }) =>
          `- ID: ${a.id}, 名前: ${a.name}, 役割: ${a.role}`
      )
      .join('\n');

    const prompt = `あなたはプレゼンテーションの聴衆シミュレーター兼、極めて精度の高い音声認識・評価AIです。
添付されたマイクの生音声データを直接聴き取り、以下の処理を行ってください。

【聴衆メンバー】
${audiencePrompt}

【経過時間】${elapsedSeconds}秒経過 (残り${remainingSeconds}秒)
【直前の文脈】${recentContext || '（発表開始）'}
【ブラウザ認識の参考テキスト（あくまで参考ヒント）】「${tentativeText}」

JSON形式で返却してください。`;

    const contents: any[] = [];
    if (audioBase64) {
      contents.push({
        inlineData: {
          mimeType: mimeType.split(';')[0] || 'audio/webm',
          data: audioBase64,
        },
      });
    }
    contents.push({ text: prompt });

    const response = await generateWithGemini({
      contents,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            transcribed_sentence: { type: Type.STRING },
            corrected_sentence: { type: Type.STRING },
            audience_reaction: {
              type: Type.OBJECT,
              properties: {
                avatar_id: { type: Type.STRING },
                emotion: {
                  type: Type.STRING,
                  enum: ['Interested', 'Impressed', 'Confused', 'Bored'],
                },
                interest_score: { type: Type.INTEGER },
                understanding_score: { type: Type.INTEGER },
                action: {
                  type: Type.STRING,
                  enum: ['nod', 'clap', 'tilt_head', 'sleep'],
                },
              },
              required: [
                'avatar_id',
                'emotion',
                'interest_score',
                'understanding_score',
                'action',
              ],
            },
            is_presentation_end: { type: Type.BOOLEAN },
            new_question_generated: { type: Type.STRING, nullable: true },
            target_avatar_id: { type: Type.STRING, nullable: true },
            audience_interaction: {
              type: Type.OBJECT,
              properties: {
                is_interaction: { type: Type.BOOLEAN },
                is_targeted: { type: Type.BOOLEAN },
                reply_avatar_id: { type: Type.STRING },
                reply_text: { type: Type.STRING },
                chorus_replies: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                action: {
                  type: Type.STRING,
                  enum: ['nod', 'clap', 'tilt_head'],
                },
              },
              required: [
                'is_interaction',
                'is_targeted',
                'reply_avatar_id',
                'reply_text',
                'chorus_replies',
                'action',
              ],
            },
            quick_comment: { type: Type.STRING },
          },
          required: [
            'transcribed_sentence',
            'corrected_sentence',
            'audience_reaction',
            'is_presentation_end',
            'audience_interaction',
          ],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    if (!parsed.corrected_sentence) {
      parsed.corrected_sentence =
        parsed.transcribed_sentence || tentativeText;
    }

    return { status: 200, data: parsed };
  } catch (error) {
    console.error('Error analyzing presentation audio:', error);
    const rawTentative = body?.tentativeText || '';
    const sentLen = rawTentative.length;
    const dynamicInterest = Math.min(95, Math.max(50, 74 + (sentLen % 21) - 10));
    const dynamicUnderstanding = Math.min(
      94,
      Math.max(48, 71 + ((sentLen * 2) % 19) - 9)
    );

    return {
      status: 200,
      data: {
        transcribed_sentence: rawTentative,
        corrected_sentence: rawTentative,
        audience_reaction: {
          avatar_id: body?.audience?.[0]?.id || 'avatar-1',
          emotion: dynamicInterest > 75 ? 'Interested' : 'Confused',
          interest_score: dynamicInterest,
          understanding_score: dynamicUnderstanding,
          action: dynamicInterest > 75 ? 'nod' : 'tilt_head',
        },
        is_presentation_end: false,
        new_question_generated: null,
        target_avatar_id: null,
        audience_interaction: {
          is_interaction: false,
          is_targeted: false,
          reply_avatar_id: body?.audience?.[0]?.id || 'avatar-1',
          reply_text: '',
          chorus_replies: [],
          action: 'nod',
        },
        quick_comment: '関心を持って聞いています',
      },
    };
  }
}

export async function handleAudienceAnswer(
  body: any
): Promise<{ status: number; data: any }> {
  try {
    const {
      currentUtterance = '',
      immediatePriorUtterance = '',
      presentationTranscript = '',
      targetAvatar = {},
      handRaiseHistory = [],
    } = body || {};

    const userQuestion = (
      currentUtterance ||
      immediatePriorUtterance ||
      ''
    ).trim();

    const roleDesc =
      targetAvatar?.role === 'professor'
        ? '大学の教授・主査。論理的妥当性、学術的・実用的な客観性、長期的視点から落ち着いた大人の口調で的確かつ知的に回答します。'
        : targetAvatar?.role === 'junior'
        ? '学部の後輩。発表内容への熱意や学びを踏まえ、素直で明瞭かつ元気な口調（「〜です！」「〜ですね！」）で簡潔に回答します。'
        : 'ゼミの同輩・同僚。現場での運用しやすさや実用性の観点から、対等な目線で率直かつ親しみやすい丁寧語（「〜ですね」「〜だと思います」）で回答します。';

    const avatarProfileText =
      (targetAvatar?.profile || '').trim() || '（事前記述なし）';
    const learnedTraitsList = Array.isArray(targetAvatar?.learnedTraits)
      ? targetAvatar.learnedTraits.filter(Boolean)
      : [];
    const learnedTraitsText =
      learnedTraitsList.length > 0
        ? learnedTraitsList.map((t: string) => `・${t}`).join('\n')
        : '（まだ追加記録なし）';

    const avatarHandRaiseSummary =
      Array.isArray(handRaiseHistory) && handRaiseHistory.length > 0
        ? handRaiseHistory
            .map((h: any, idx: number) => {
              const didRaise =
                Array.isArray(h.raisedAvatarIds) &&
                h.raisedAvatarIds.includes(targetAvatar?.id);
              return `#${idx + 1} 発表者の問いかけ「${
                h.prompt
              }」 → あなたは【${
                didRaise
                  ? '手を挙げた（該当する）'
                  : '手を挙げなかった（該当しない）'
              }】`;
            })
            .join('\n')
        : '（挙手履歴なし）';

    const prompt = `あなたはプレゼンテーションを聞いている聴衆アバター「${
      targetAvatar?.name || '聴衆'
    }」（性別: ${
      targetAvatar?.gender === 'female' ? '女性' : '男性'
    }）です。
【あなたの立場・キャラクター】
${roleDesc}

【あなたの事前設定プロフィール（性格・経験・バックグラウンド）】
${avatarProfileText}

【発表中に確定したあなたの特徴・挙手および発言の事実（絶対遵守）】
${learnedTraitsText}

【これまでの挙手質問に対するあなた自身の挙手履歴（絶対遵守）】
${avatarHandRaiseSummary}

【これまでの発表全体の文字起こし文脈】
${presentationTranscript || '（発表進行中）'}

【発表者からの直接の質問・問いかけ内容】
「${userQuestion || '（指名・質問）'}」

【命令（絶対に遵守すること）】
1. 発表者があなたを名指しで指名し、質問や意見を求めています。
2. 【超重要：挙手履歴・プロフィールとの完全な一貫性】
   ・もし直前や過去の挙手質問（例：「海外に行ったことがある人手を挙げて」「パスポートを持っている人手を挙げて」等）であなたが【手を挙げた（該当する）】記録がある場合、あなたは100%その経験・属性を持っています！
   ・そのため「どこに行きましたか？」「いつ行きましたか？」「どうでしたか？」等と聞かれた際に、「行ったことはありません」「持っていません」などと答えることは【絶対禁止】です。必ず「学生時代にハワイと台湾へ行きました」「学会でアメリカへ行きました」のように、あなたが手を挙げた事実に合致する具体的で自然なエピソードを答えてください。
   ・逆に、挙手質問で【手を挙げなかった（該当しない）】記録がある場合は、その事実（行ったことがない・持っていない等）に100%矛盾しないように回答してください。
   ・もしプロフィールや履歴にまだ記述されていない新しい個人的な質問を聞かれた場合は、あなたの立場とこれまでの履歴に矛盾しない自然な設定・経験をその場で決めて回答し、その新しく確定したあなた自身の特徴を newTrait に1文で記録してください（例: "海外旅行で台湾とハワイに行ったことがある"）。
3. 以下の定型的・抽象的なお礼や挨拶フレーズは【絶対に禁止】です:
   ×「ご質問ありがとうございます」「ご指名ありがとうございます」「その点については非常に重要/大切だと考えております」
4. 発表者の問いかけ「${userQuestion}」に対して、2〜3文（60〜110文字程度）で人間らしく自然にズバリ答えてください。

JSON形式で返却してください。`;

    const response = await generateWithGemini({
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            replyText: {
              type: Type.STRING,
              description:
                '発表者の問いかけに対する一貫性のある具体的な回答メッセージ（60〜110文字）',
            },
            action: {
              type: Type.STRING,
              enum: ['nod', 'tilt_head'],
            },
            newTrait: {
              type: Type.STRING,
              description:
                '今回の回答によって新たに確定・追加されたアバター自身の特徴や経験',
            },
          },
          required: ['replyText', 'action'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    const rawReply = (parsed.replyText || '').trim();
    const cleanedReply = rawReply
      ? rawReply
          .replace(/^(ご質問|ご指名)ありがとうございます[。、！! ]*/g, '')
          .trim()
      : '';

    const replyText =
      cleanedReply ||
      createDynamicAudienceReply(
        userQuestion,
        presentationTranscript,
        targetAvatar?.role || 'peer',
        targetAvatar?.name || '聴衆',
        targetAvatar?.profile,
        targetAvatar?.learnedTraits,
        handRaiseHistory,
        targetAvatar?.id
      );

    return {
      status: 200,
      data: {
        hasQuestionToAnswer: true,
        replyText,
        action: parsed.action || 'nod',
        newTrait:
          (parsed.newTrait || '').trim() ||
          `「${userQuestion}」に対し「${replyText}」と回答した`,
        isLlmGenerated: !!cleanedReply,
      },
    };
  } catch (error: any) {
    console.error('Error in /api/presentation/audience-answer:', error);
    const errorMsg = error?.message || String(error);
    const isSpendCapError =
      errorMsg.includes('Spend cap breached') ||
      errorMsg.includes('PERMISSION_DENIED') ||
      errorMsg.includes('quota');

    const {
      currentUtterance,
      immediatePriorUtterance,
      presentationTranscript,
      targetAvatar,
      handRaiseHistory,
    } = body || {};
    const qText = currentUtterance || immediatePriorUtterance || '';
    const fallbackReply = createDynamicAudienceReply(
      qText,
      presentationTranscript || '',
      targetAvatar?.role || 'peer',
      targetAvatar?.name || '聴衆',
      targetAvatar?.profile,
      targetAvatar?.learnedTraits,
      handRaiseHistory,
      targetAvatar?.id
    );
    return {
      status: 200,
      data: {
        hasQuestionToAnswer: true,
        replyText: fallbackReply,
        action: 'nod',
        newTrait: `「${qText}」に対し「${fallbackReply}」と回答した`,
        isLlmGenerated: false,
        isSpendCapError,
        errorMessage: errorMsg,
      },
    };
  }
}

export async function handleGenerateQaQuestions(
  body: any
): Promise<{ status: number; data: any }> {
  try {
    const { transcriptHistory = [], audience = [] } = body || {};

    if (!Array.isArray(transcriptHistory) || transcriptHistory.length === 0) {
      return { status: 200, data: { questions: [] } };
    }

    const transcriptText = transcriptHistory
      .map(
        (t: { time: number; text: string }) =>
          `[${Math.floor((t.time || 0) / 60)}分${(t.time || 0) % 60}秒] ${
            t.text
          }`
      )
      .join('\n');

    const audiencePrompt = audience
      .map(
        (a: { id: string; name: string; role: string; roleLabel?: string }) =>
          `- ID: ${a.id}, 氏名: ${a.name}, 役割: ${a.role} (${
            a.roleLabel || a.role
          })`
      )
      .join('\n');

    const prompt = `あなたはプレゼンテーションの質疑応答（Q&A）セッションに参加している聴衆アバターたちです。
発表者が実際に行ったプレゼンテーションの全文字起こしログを読み込み、その発表内容に100%基づいた論理的で自然な質問を生成してください。

【聴衆メンバー】
${audiencePrompt}
- professor（教授・主査）: 提案の妥当性、客観的根拠、従来手法や代替案との比較、前提条件や課題について鋭く論理的に質問します。
- peer（同輩・ゼミ生）: 実際の運用・実装上の工夫、具体的なユースケース、トレードオフや現場での課題について質問します。
- junior（後輩）: 発表内容への素直な関心から、初心者が疑問に思うポイントや具体的な活用イメージについて質問します。

【発表者の全文字起こしログ】
${transcriptText}

【厳守ルール】
1. 発表者が実際に話したテーマ・主張・内容に100%基づいた質問のみを生成してください。発表されていない無関係なトピック（無関係なアプリや研究など）の質問は絶対にしないでください。
2. 「おはようございます」「ご清聴ありがとうございました」などの挨拶や定型句を質問の対象にすることは絶対に禁止です。
3. もし文字起こしログに挨拶しかなく、実質的な発表内容がまだ全く含まれていない場合は、questions を空配列 [] にして返してください。
4. 質問数は1人1問に固定する必要はありません。発表内容に疑問や関心を持ったアバターだけが質問します（全体で2〜4問程度、0問の人がいても1人が複数質問しても構いません）。

JSON形式で返却してください。`;

    const response = await generateWithGemini({
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  avatarId: { type: Type.STRING },
                  avatarName: { type: Type.STRING },
                  role: {
                    type: Type.STRING,
                    enum: ['professor', 'peer', 'junior'],
                  },
                  questionText: { type: Type.STRING },
                },
                required: ['avatarId', 'avatarName', 'role', 'questionText'],
              },
            },
          },
          required: ['questions'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    let validQuestions = (parsed.questions || []).filter(
      (q: any) => q.questionText && q.questionText.trim().length >= 10
    );

    if (
      validQuestions.length === 0 &&
      Array.isArray(audience) &&
      audience.length > 0
    ) {
      validQuestions = audience
        .slice(0, Math.min(3, audience.length))
        .map((a: any) => {
          const role = a.role || 'peer';
          let qText = '';
          if (role === 'professor') {
            qText =
              'ご発表ありがとうございました。今回の提案内容において、客観的な実証データや従来手法との違いについて詳しく教えていただけますか？';
          } else if (role === 'junior') {
            qText =
              '発表お疲れ様でした！今回の提案を実際に応用するにあたって、初心者が使いやすくするための工夫について教えてください！';
          } else {
            qText =
              '素晴らしいプレゼンでした。現場での運用や実装を想定した際に、コストや工数面での一番のポイントはどこになりますか？';
          }
          return {
            avatarId: a.id,
            avatarName: a.name,
            role,
            questionText: qText,
          };
        });
    }

    return { status: 200, data: { questions: validQuestions } };
  } catch (error: any) {
    console.error('Error in /api/presentation/generate-qa-questions:', error);
    const { audience = [] } = body || {};
    const fallbackQuestions = (Array.isArray(audience) ? audience : [])
      .slice(0, 3)
      .map((a: any) => {
        const role = a.role || 'peer';
        let qText = '';
        if (role === 'professor') {
          qText =
            'ご発表ありがとうございました。今回の提案内容において、客観的な実証データや従来手法との違いについて詳しく教えていただけますか？';
        } else if (role === 'junior') {
          qText =
            '発表お疲れ様でした！今回の提案を実際に応用するにあたって、初心者が使いやすくするための工夫について教えてください！';
        } else {
          qText =
            '素晴らしいプレゼンでした。現場での運用や実装を想定した際に、コストや工数面での一番のポイントはどこになりますか？';
        }
        return {
          avatarId: a.id,
          avatarName: a.name,
          role,
          questionText: qText,
        };
      });
    return { status: 200, data: { questions: fallbackQuestions } };
  }
}

export async function handleEvaluateAnswer(
  body: any
): Promise<{ status: number; data: any }> {
  try {
    const { question, userAnswer, avatar, recentTranscript = '' } = body || {};
    const followUpCount = Number(question?.followUpCount || 0);

    const roleLabel =
      avatar?.role === 'professor'
        ? '大学の主査・教授（論理的妥当性や客観的根拠を重視する審査役）'
        : avatar?.role === 'junior'
        ? '後輩（初心者視点で素朴に理解できたかを確認する役）'
        : '同輩・ゼミ生（実務や現場のリアルな難しさの観点から聞く役）';

    const prompt = `あなたはプレゼンテーションの質疑応答で質問をした聴衆アバターです。
自分の質問に対して、発表者が口頭で回答しました。
その回答を聞いて、納得して感謝を述べるか、それとも追加で1問だけ確認するかを判定してください。

【あなたのプロフィール】
名前: ${avatar?.name || '質問者'}
立場: ${roleLabel}
これまでの追加質問回数: ${followUpCount}回

【あなたの質問】
「${question?.questionText || ''}」

【発表者の回答（音声認識テキスト）】
「${userAnswer || '（回答なし・無言）'}」

【発表の全文字起こし文脈】
${recentTranscript || '（文脈なし）'}

【判定基準と出力ルール（重要：寛容に判定し、しつこく詰めすぎないこと）】
1. 原則として納得する (isSatisfied: true) — 全体の85%以上はこちらにしてください:
   - 口頭での即興回答かつ音声認識テキストであるため、多少簡潔であったり言葉足らずであっても、発表者が質問のテーマ・意図に沿って自分なりの理由・考え・方針を答えていれば、**好意的に解釈して必ず isSatisfied: true（納得・解決）** にしてください。
   - また、すでに追加質問への回答である場合（これまでの追加質問回数が1回以上の場合）は、**無条件で必ず isSatisfied: true** にしてください。
   - feedbackText: 回答内容のキーワードに触れつつ、納得の意と感謝を伝える温かく自然な一言（例:「なるほど、〇〇という点についてよく分かりました。ご丁寧な説明ありがとうございます！」など、40〜75文字）。
   - followUpQuestionText: 空文字 ""
   - action: "nod"

2. 追加の質問をする場合 (isSatisfied: false) — 全体の15%以下の例外的な場合のみ:
   - これまでの追加質問回数が 0回 であり、かつ発表者が「わかりません」「特にありません」と回答を放棄した場合や、質問と全く無関係なことしか言っていない場合のみ isSatisfied: false にしてください。
   - feedbackText: 回答への一言礼を述べた上で、もう一歩だけ確認したい点を穏やかに切り出す発言（50〜85文字）。
   - followUpQuestionText: 次に発表者に答えさせる具体的な追加質問（50〜85文字）。
   - action: "tilt_head"

JSON形式で返却してください。`;

    const response = await generateWithGemini({
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isSatisfied: { type: Type.BOOLEAN },
            feedbackText: { type: Type.STRING },
            followUpQuestionText: { type: Type.STRING, nullable: true },
            action: { type: Type.STRING, enum: ['nod', 'tilt_head'] },
          },
          required: ['isSatisfied', 'feedbackText', 'action'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    const isSatisfied = followUpCount >= 1 ? true : Boolean(parsed.isSatisfied);

    return {
      status: 200,
      data: {
        isSatisfied,
        feedbackText:
          isSatisfied && !parsed.isSatisfied
            ? 'なるほど、ご説明いただきよく分かりました。ありがとうございました！'
            : parsed.feedbackText || 'ご回答ありがとうございました。',
        followUpQuestionText: isSatisfied
          ? null
          : parsed.followUpQuestionText || null,
        action: isSatisfied ? 'nod' : parsed.action || 'tilt_head',
      },
    };
  } catch (error: any) {
    console.error('Error evaluating answer:', error);
    return {
      status: 500,
      data: {
        error: 'Failed to evaluate answer via LLM',
        details: error?.message || String(error),
      },
    };
  }
}

export async function handleSummaryReport(
  body: any
): Promise<{ status: number; data: any }> {
  try {
    const {
      transcriptHistory = [],
      qaHistory = [],
      audience = [],
      durationSeconds = 0,
    } = body || {};

    const deduplicatedTranscript = (
      Array.isArray(transcriptHistory) ? transcriptHistory : []
    ).filter(
      (item: any, idx: number, arr: any[]) =>
        idx === 0 ||
        (item?.text || '').trim() !== (arr[idx - 1]?.text || '').trim()
    );

    const transcriptText = deduplicatedTranscript
      .map(
        (
          t: {
            time: number;
            text: string;
            interest: number;
            understanding: number;
            comment?: string;
          },
          idx: number
        ) =>
          `#${idx + 1} [${Math.floor((t.time || 0) / 60)}分${
            (t.time || 0) % 60
          }秒] (関心:${t.interest}%, 理解:${t.understanding}%) 「${t.text}」${
            t.comment ? ` ※${t.comment}` : ''
          }`
      )
      .join('\n');

    const hasInteractiveAudienceDialogue = deduplicatedTranscript.some(
      (t: any) =>
        /双方向対話|の回答】|\?|？|ですか|ますか|でしょうか|やってますか|やっていますか|どう思|意見/.test(
          `${t?.text || ''} ${t?.comment || ''}`
        )
    );

    const rawQaHistory = Array.isArray(qaHistory) ? qaHistory : [];
    const answeredQuestions = rawQaHistory.filter(
      (q: any) =>
        q &&
        q.isResolved &&
        !q.isSkipped &&
        typeof q.userAnswer === 'string' &&
        q.userAnswer.trim() !== ''
    );
    const skippedQuestions = rawQaHistory.filter(
      (q: any) =>
        q &&
        (!q.isResolved ||
          q.isSkipped ||
          !q.userAnswer ||
          q.userAnswer.trim() === '')
    );

    let qaText = '';
    if (answeredQuestions.length > 0) {
      qaText +=
        '【実際に回答が行われた質問】\n' +
        answeredQuestions
          .map(
            (q: any, idx: number) =>
              `#${idx + 1} 質問者: ${q.avatarName || '聴衆'} (${
                q.role || 'peer'
              })\n` +
              `・質問内容: 「${q.questionText || ''}」\n` +
              `・発表者の実際の回答: 「${q.userAnswer || ''}」\n` +
              `・追加質問回数: ${q.followUpCount || 0}回 / 質問者の反応: 「${
                q.avatarFeedback || '（良好）'
              }」`
          )
          .join('\n\n');
    } else {
      qaText +=
        '（実際に回答が行われた質問はありません。質疑応答は時間の都合等により未実施またはスキップされました）';
    }

    if (skippedQuestions.length > 0) {
      qaText +=
        `\n\n【時間の都合等でスキップ・未実施となった質問の件数】\n` +
        `合計 ${skippedQuestions.length} 問が時間の都合などにより未実施（スキップ）となりました。\n` +
        `（※最重要ルール: 未実施・スキップされた質問の具体的な質問内容について「〇〇に答えられていない」「〇〇の説明が不足している」といった個別の内容面での批判・減点は絶対に禁止です。未実施の質問はフィードバック対象外としてください。ただし「全${rawQaHistory.length}問中${skippedQuestions.length}問が未実施となった」という事実は、本編の発表時間配分（タイムキーピング）や構成のテンポの指標として、適度に全体の時間管理スコア（数点程度の調整）や次回へのアドバイスに反映してください）`;
    }

    const audienceText = audience
      .map((a: { name: string; role: string }) => `${a.name}(${a.role})`)
      .join(', ');

    const prompt = `あなたはプレゼンテーションおよび質疑応答（Q&A）の専門評価アドバイザーです。
以下の「プレゼンテーション全文字起こしログ」と「質疑応答（Q&A）の質問・発表者の回答ログ」を隅々まで読み込み、今回の発表内容と質疑応答の受け答えに100%基づいた個別具体性の高い評価レポートを作成してください。

【厳守ルール（定型文・使い回し表現の完全禁止）】
- どのプレゼンにも当てはまるような抽象的な定型文は絶対に書かないでください。
- 必ず発表者が実際に話した固有のトピック・キーワード・主張に言及して評価してください。

【最重要ルール（オーディエンスとの双方向対話の高評価・発話間隔を「停滞/沈黙」と批判することの絶対禁止）】
1. プレゼン中に発表者がオーディエンスへ問いかけや指名を行い、双方向のやり取りを行っている箇所があります。文字起こしログのタイムスタンプ間に時間間隔が空いている箇所は、発表者がオーディエンスに問いかけをしてオーディエンス（アバター）が発言・回答していた「双方向の対話時間」であり、決して発表者が沈黙していたりやり取りが停滞していたわけではありません。
2. したがって、改善点（improvements）や総評（general_comment）、スコア低下ポイント（dip_moments）において「○分○秒から○分○秒までやり取りが停滞した」「沈黙があった」「間が空いた」「空白があった」といった指摘は**絶対に行わないでください**。
3. むしろ、一方的に話すだけでなく発表中にオーディエンスへ問いかけや指名を行い、双方向のやり取り（インタラクション）を取り入れたことは、聴衆を巻き込む極めて効果的なプレゼン手法として**高く評価**してください。

【最重要ルール（質疑応答・スキップされた質問の評価方針）】
1. 質問ごとの個別回答評価は、【実際に回答が行われた質問】（${answeredQuestions.length}問）のみを対象にしてください。
2. 時間の都合等でスキップ・未実施となった質問（${skippedQuestions.length}問）については、具体的な質問内容テキストを個別の改善点として批判・減点してはいけません。
3. 一方で、質問をスキップしたこと自体は「本編の時間配分（タイムキーピング）」の指標となります。全体の総合スコアや「次回への具体的アドバイス」「総評」において、時間管理の観点から適度に加味し、前向きなアドバイスを記述してください。

【発表概要】
- 発表時間: ${Math.floor(durationSeconds / 60)}分${durationSeconds % 60}秒
- 発話センテンス数: ${deduplicatedTranscript.length}文
- 聴衆構成: ${audienceText}
- 本編中のオーディエンスとの双方向対話: ${
      hasInteractiveAudienceDialogue
        ? 'あり（聴衆への問いかけ・対話を実施 — 高く評価すること）'
        : 'なし'
    }
- 質疑応答状況: 回答済み ${answeredQuestions.length}問 / スキップ・未実施 ${
      skippedQuestions.length
    }問

【プレゼンテーション文字起こしログ（時系列）】
${transcriptText || '（発話ログなし）'}

【質疑応答（Q&A）での記録】
${qaText}

JSON形式で返却してください。`;

    const response = await generateWithGemini({
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overall_score: { type: Type.INTEGER },
            clarity_score: { type: Type.NUMBER },
            logic_score: { type: Type.NUMBER },
            engagement_score: { type: Type.NUMBER },
            strengths: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            improvements: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            next_advice: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            general_comment: { type: Type.STRING },
            dip_moments: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  timestamp: { type: Type.INTEGER },
                  text: { type: Type.STRING },
                  reason: { type: Type.STRING },
                  advice: { type: Type.STRING },
                },
                required: ['timestamp', 'text', 'reason', 'advice'],
              },
            },
          },
          required: [
            'overall_score',
            'clarity_score',
            'logic_score',
            'engagement_score',
            'strengths',
            'improvements',
            'next_advice',
            'general_comment',
          ],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');

    const normalizeSubScore = (val: any, fallback: number): number => {
      let num = Number(val);
      if (!Number.isFinite(num) || num <= 0) return fallback;
      while (num > 10) {
        num = num / 10;
      }
      return Number(Math.max(0, Math.min(10, num)).toFixed(1));
    };

    const normalizeOverallScore = (val: any, fallback: number): number => {
      let num = Number(val);
      if (!Number.isFinite(num) || num <= 0) return fallback;
      if (num <= 10) {
        num = num * 10;
      }
      return Math.round(Math.max(0, Math.min(100, num)));
    };

    parsed.overall_score = normalizeOverallScore(parsed.overall_score, 80);
    parsed.clarity_score = normalizeSubScore(parsed.clarity_score, 8.0);
    parsed.logic_score = normalizeSubScore(parsed.logic_score, 7.8);
    parsed.engagement_score = normalizeSubScore(parsed.engagement_score, 8.0);

    if (Array.isArray(parsed.improvements)) {
      parsed.improvements = parsed.improvements.map((imp: string) => {
        if (/(停滞|沈黙|無言の間|空白時間|間が空い)/.test(imp)) {
          return 'オーディエンスへの問いかけ後の本編復帰時に、対話で得られた回答を一言要約してから次の論点へ繋げると、さらに説得力が高まります。';
        }
        return imp;
      });
    }
    if (Array.isArray(parsed.dip_moments)) {
      parsed.dip_moments = parsed.dip_moments.filter(
        (d: any) =>
          !/(停滞|沈黙|無言)/.test(`${d?.reason || ''} ${d?.advice || ''}`)
      );
    }

    return { status: 200, data: parsed };
  } catch (error: any) {
    console.error('Error generating summary report:', error);

    const { transcriptHistory = [], qaHistory = [] } = body || {};
    const rawQa = Array.isArray(qaHistory) ? qaHistory : [];
    const answeredCount = rawQa.filter(
      (q: any) => q.isResolved && !q.isSkipped && q.userAnswer
    ).length;
    const skippedCount = rawQa.length - answeredCount;

    const transcriptList = Array.isArray(transcriptHistory)
      ? transcriptHistory
      : [];
    const avgInterest =
      transcriptList.length > 0
        ? transcriptList.reduce(
            (acc: number, t: any) => acc + (t.interest || 70),
            0
          ) / transcriptList.length
        : 72;
    const avgUnderstanding =
      transcriptList.length > 0
        ? transcriptList.reduce(
            (acc: number, t: any) => acc + (t.understanding || 68),
            0
          ) / transcriptList.length
        : 70;

    const timekeepingDeduction = Math.min(10, skippedCount * 3);
    const baseScore = Math.round(avgInterest * 0.48 + avgUnderstanding * 0.52);
    const overallScore = Math.max(
      50,
      Math.min(95, baseScore - timekeepingDeduction)
    );

    const clarityScore = Number(
      Math.max(
        4.0,
        Math.min(9.8, avgUnderstanding / 10 - (skippedCount > 0 ? 0.3 : 0))
      ).toFixed(1)
    );
    const logicScore = Number(
      Math.max(4.0, Math.min(9.8, avgUnderstanding / 10)).toFixed(1)
    );
    const engagementScore = Number(
      Math.max(4.0, Math.min(9.8, avgInterest / 10)).toFixed(1)
    );

    const improvements = [
      '発表中盤における具体例や根拠データの提示をさらに増やすことで、説得力が向上します。',
      '専門用語が登場する場面で、1文程度の平易な補足解説を入れると聴衆の理解度がより安定します。',
    ];
    if (skippedCount > 0) {
      improvements.push(
        `質疑応答で${skippedCount}問が時間の都合により未実施となりました。本編の時間配分を少し見直し、質疑応答の対話時間を確保できるとさらに良くなります。`
      );
    } else {
      improvements.push(
        '重要な結論を述べる際、直前に一呼吸（0.5秒の間）を置くと強調効果が高まります。'
      );
    }

    const nextAdvice = [
      '本編の要点を3点以内に整理し、各スライドのメッセージをシンプルに保つ。',
      skippedCount > 0
        ? '本編の時間を全体の70〜80%に収める意識を持ち、質疑応答にゆとりを持たせる。'
        : '聴衆からの質問に対して、まず「結論」を一言で述べてから理由を補足する。',
      '重要キーワードを述べる際は、抑揚をつけてトーンを少し強調する。',
    ];

    const generalComment = `発表全体の構成が整理されており、聴衆の関心を引きつける工夫が見られました。${
      skippedCount > 0
        ? '時間の都合で質疑応答の一部がスキップされましたが、本編の時間配分（タイムキーピング）を意識して質疑時間を確保できるようにすると、より完成度の高いプレゼンテーションになります。'
        : '質疑応答まで丁寧に対応されており、聴衆との良好なコミュニケーションが成立していました。'
    }今後の本番でのご活躍を期待しています！`;

    return {
      status: 200,
      data: {
        overall_score: overallScore,
        clarity_score: clarityScore,
        logic_score: logicScore,
        engagement_score: engagementScore,
        strengths: [
          '発表全体の構成が分かりやすく、聴衆が集中して聞きやすいペースを維持できていました。',
          '重要ポイントでの論理的な語り口が明確で、テーマへの理解を深める効果がありました。',
          answeredCount > 0
            ? '質疑応答において、質問の意図を汲み取った誠実な受け答えができていました。'
            : '堂々とした発表態度で、メッセージを会場全体に届ける熱意が伝わりました。',
        ],
        improvements,
        next_advice: nextAdvice,
        general_comment: generalComment,
        dip_moments: [],
        isFallback: true,
        isSpendCapError:
          error?.message?.includes('Spend cap') ||
          error?.message?.includes('PERMISSION_DENIED'),
      },
    };
  }
}

// L2 Server-side LRU cache for TTS audio
const ttsAudioCache = new Map<
  string,
  { audioBase64: string; mimeType: string; isNeuralFallback?: boolean }
>();
const MAX_TTS_CACHE_ITEMS = 300;

const serverInFlightTtsMap = new Map<
  string,
  Promise<{ audioBase64: string; mimeType: string; isNeuralFallback?: boolean }>
>();

const MAX_CONCURRENT_TTS_REQUESTS = 2;
let activeTtsRequestCount = 0;
const ttsWaitQueue: Array<{
  priority: boolean;
  run: () => void;
}> = [];

function runWithTtsConcurrency<T>(
  priority: boolean,
  task: () => Promise<T>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const execute = async () => {
      activeTtsRequestCount++;
      try {
        const result = await task();
        resolve(result);
      } catch (err) {
        reject(err);
      } finally {
        activeTtsRequestCount--;
        const nextJob = ttsWaitQueue.shift();
        if (nextJob) {
          nextJob.run();
        }
      }
    };

    if (activeTtsRequestCount < MAX_CONCURRENT_TTS_REQUESTS) {
      execute();
    } else if (priority) {
      const firstNonPriorityIdx = ttsWaitQueue.findIndex((j) => !j.priority);
      if (firstNonPriorityIdx === -1) {
        ttsWaitQueue.push({ priority: true, run: execute });
      } else {
        ttsWaitQueue.splice(firstNonPriorityIdx, 0, {
          priority: true,
          run: execute,
        });
      }
    } else {
      ttsWaitQueue.push({ priority: false, run: execute });
    }
  });
}

function splitJapaneseTextForTts(text: string, maxLen = 140): string[] {
  const clean = text.trim();
  if (clean.length <= maxLen) return [clean];

  const rawParts = clean.split(/(?<=[。！？!?、\n])/);
  const chunks: string[] = [];
  let current = '';

  for (const part of rawParts) {
    if (!part) continue;
    if ((current + part).length <= maxLen) {
      current += part;
    } else {
      if (current) chunks.push(current);
      if (part.length <= maxLen) {
        current = part;
      } else {
        for (let i = 0; i < part.length; i += maxLen) {
          chunks.push(part.slice(i, i + maxLen));
        }
        current = '';
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [clean.slice(0, maxLen)];
}

async function synthesizeGoogleNeuralSpeechBase64(text: string): Promise<{
  audioBase64: string;
  mimeType: string;
  isNeuralFallback: boolean;
}> {
  const chunks = splitJapaneseTextForTts(text, 140);
  const buffers: Buffer[] = [];

  for (const chunk of chunks) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=ja&client=tw-ob&q=${encodeURIComponent(
      chunk
    )}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    if (!response.ok) {
      throw new Error(`Cloud neural TTS status ${response.status}`);
    }
    const arrBuf = await response.arrayBuffer();
    if (arrBuf.byteLength > 0) {
      buffers.push(Buffer.from(arrBuf));
    }
  }

  if (buffers.length === 0) {
    throw new Error('Empty audio buffer from cloud neural TTS');
  }

  return {
    audioBase64: Buffer.concat(buffers).toString('base64'),
    mimeType: 'audio/mpeg',
    isNeuralFallback: true,
  };
}

interface Neural2PersonaConfig {
  voiceName: 'ja-JP-Neural2-B' | 'ja-JP-Neural2-C' | 'ja-JP-Neural2-D';
  pitch: number;
  speakingRate: number;
}

function getNeural2PersonaConfig(
  voiceName: string,
  role: string,
  gender: string
): Neural2PersonaConfig {
  if (voiceName === 'Charon' || (role === 'professor' && gender === 'male')) {
    return {
      voiceName: 'ja-JP-Neural2-D',
      pitch: -3.0,
      speakingRate: 1.15,
    };
  }
  if (voiceName === 'Fenrir' || (role === 'peer' && gender === 'male')) {
    return {
      voiceName: 'ja-JP-Neural2-C',
      pitch: -1.2,
      speakingRate: 1.22,
    };
  }
  if (voiceName === 'Puck' || (role === 'junior' && gender === 'male')) {
    return {
      voiceName: 'ja-JP-Neural2-C',
      pitch: 2.2,
      speakingRate: 1.3,
    };
  }
  if (voiceName === 'Kore' || (role === 'professor' && gender === 'female')) {
    return {
      voiceName: 'ja-JP-Neural2-B',
      pitch: -1.8,
      speakingRate: 1.18,
    };
  }
  if (voiceName === 'Zephyr' || gender === 'female') {
    return {
      voiceName: 'ja-JP-Neural2-B',
      pitch: 1.8,
      speakingRate: 1.28,
    };
  }
  return {
    voiceName: gender === 'female' ? 'ja-JP-Neural2-B' : 'ja-JP-Neural2-C',
    pitch: 0.0,
    speakingRate: 1.22,
  };
}

async function synthesizeGoogleCloudNeural2(
  text: string,
  persona: Neural2PersonaConfig,
  apiKey: string
): Promise<{ audioBase64: string; mimeType: string }> {
  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;
  const payload = {
    input: { text },
    voice: {
      languageCode: 'ja-JP',
      name: persona.voiceName,
    },
    audioConfig: {
      audioEncoding: 'MP3',
      pitch: persona.pitch,
      speakingRate: persona.speakingRate,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorJson: any = await response.json().catch(() => ({}));
    throw new Error(
      `Cloud Neural2 TTS Error ${response.status}: ${
        errorJson?.error?.message || response.statusText
      }`
    );
  }

  const data: any = await response.json();
  if (!data?.audioContent) {
    throw new Error('Cloud Neural2 response did not contain audioContent');
  }

  return {
    audioBase64: data.audioContent,
    mimeType: 'audio/mpeg',
  };
}

let cloudNeural2Permitted: boolean | null = null;

export async function handleTtsSynthesis(
  body: any
): Promise<{ status: number; data: any }> {
  try {
    const {
      text = '',
      voiceName = 'Charon',
      role = 'peer',
      gender = 'male',
      priority = true,
    } = body || {};
    const cleanText = String(text || '')
      .trim()
      .slice(0, 360);
    if (!cleanText) {
      return { status: 400, data: { error: 'text is required' } };
    }

    const persona = getNeural2PersonaConfig(voiceName, role, gender);
    const cacheKey = `neural2::${persona.voiceName}::p${persona.pitch}::r${persona.speakingRate}::${cleanText}`;

    const cached = ttsAudioCache.get(cacheKey);
    if (cached) {
      return {
        status: 200,
        data: {
          audioBase64: cached.audioBase64,
          mimeType: cached.mimeType,
          isNeuralFallback: Boolean((cached as any).isNeuralFallback),
          voiceName: persona.voiceName,
          cached: true,
        },
      };
    }

    let synthesisPromise = serverInFlightTtsMap.get(cacheKey);
    if (!synthesisPromise) {
      synthesisPromise = runWithTtsConcurrency(Boolean(priority), async () => {
        const cachedNow = ttsAudioCache.get(cacheKey);
        if (cachedNow) return cachedNow;

        const googleTtsApiKey =
          process.env.GOOGLE_TTS_API_KEY || process.env.GEMINI_API_KEY || '';

        if (googleTtsApiKey && cloudNeural2Permitted !== false) {
          try {
            const neural2Result = await synthesizeGoogleCloudNeural2(
              cleanText,
              persona,
              googleTtsApiKey
            );
            cloudNeural2Permitted = true;
            const resultEntry = {
              audioBase64: neural2Result.audioBase64,
              mimeType: neural2Result.mimeType,
              isNeuralFallback: false,
            };

            if (ttsAudioCache.size >= MAX_TTS_CACHE_ITEMS) {
              const oldestKey = ttsAudioCache.keys().next().value;
              if (oldestKey) ttsAudioCache.delete(oldestKey);
            }
            ttsAudioCache.set(cacheKey, resultEntry);
            return resultEntry;
          } catch (neural2Err: any) {
            const msg = String(neural2Err?.message || neural2Err);
            if (
              msg.includes('403') ||
              msg.includes('401') ||
              msg.includes('400') ||
              msg.includes('PERMISSION_DENIED') ||
              msg.includes('API_KEY_SERVICE_BLOCKED')
            ) {
              cloudNeural2Permitted = false;
            }
            console.warn('Google Cloud Neural2 synthesis notice:', msg);
          }
        }

        const neuralFallbackResult =
          await synthesizeGoogleNeuralSpeechBase64(cleanText);
        const resultEntry = {
          audioBase64: neuralFallbackResult.audioBase64,
          mimeType: neuralFallbackResult.mimeType,
          isNeuralFallback: true,
        };

        if (ttsAudioCache.size >= MAX_TTS_CACHE_ITEMS) {
          const oldestKey = ttsAudioCache.keys().next().value;
          if (oldestKey) ttsAudioCache.delete(oldestKey);
        }
        ttsAudioCache.set(cacheKey, resultEntry);
        return resultEntry;
      }).finally(() => {
        serverInFlightTtsMap.delete(cacheKey);
      });

      serverInFlightTtsMap.set(cacheKey, synthesisPromise);
    }

    const result = await synthesisPromise;
    return {
      status: 200,
      data: {
        audioBase64: result.audioBase64,
        mimeType: result.mimeType,
        isNeuralFallback: Boolean(result.isNeuralFallback),
        voiceName: persona.voiceName,
        cached: false,
      },
    };
  } catch {
    return {
      status: 503,
      data: {
        error: 'TTS synthesis temporarily unavailable',
        fallback: true,
      },
    };
  }
}
