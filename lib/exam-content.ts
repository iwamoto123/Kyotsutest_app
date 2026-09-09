export type Sentence = { id: string; en: string; ja: string };
export const INTRO: Sentence = {
  id: 'intro',
  en: 'You are reading a notice about an evening event at a museum.',
  ja: 'あなたは博物館で開かれる夜のイベントのお知らせを読んでいます。',
};
export const PASSAGE: {
  title?: string;
  titleJa?: string;
  sentences: Sentence[];
}[] = [
  {
    sentences: [
      {
        id: 's0',
        en: 'The museum will stay open until 9 p.m. this Friday.',
        ja: '今週の金曜日、博物館は午後9時まで開館します。',
      },
      {
        id: 's1',
        en: 'Students can enter for free by showing a student ID.',
        ja: '学生は学生証を見せると無料で入館できます。',
      },
    ],
  },
  {
    title: 'Telescope workshop',
    titleJa: '望遠鏡の体験講座',
    sentences: [
      {
        id: 's2',
        en: 'The telescope workshop begins at 7 p.m. and has only twelve places.',
        ja: '望遠鏡の体験講座は午後7時に始まり、定員は12人です。',
      },
      {
        id: 's3',
        en: 'To reserve a place, complete the online form by Thursday.',
        ja: '参加枠を予約するには、木曜日までにオンラインフォームに記入してください。',
      },
    ],
  },
  {
    title: 'Update from the team',
    titleJa: '担当者からの最新のお知らせ',
    sentences: [
      {
        id: 's4',
        en: 'If the sky is cloudy, the workshop will move indoors.',
        ja: '曇りの場合、体験講座の会場は屋内に移ります。',
      },
      {
        id: 's5',
        en: 'The café closes at 6 p.m., but drinks are allowed in the garden.',
        ja: 'カフェは午後6時に閉まりますが、庭で飲み物を飲むことはできます。',
      },
    ],
  },
];
export const QUESTIONS = [
  {
    en: 'How can a student enter for free?',
    ja: '学生が無料で入館するには、どうすればよいですか？',
    choices: [
      ['Show a student ID.', '学生証を見せる。'],
      ['Arrive before 6 p.m.', '午後6時より前に到着する。'],
      ['Complete the workshop form.', '体験講座のフォームに記入する。'],
      ['Bring a drink.', '飲み物を持参する。'],
    ],
    answer: 0,
    evidence: 's1',
    skill: '入館の条件',
    explanation:
      'by showing a student ID が「学生証を見せることで」。無料になる条件と一致します。',
  },
  {
    en: 'What should you do to secure a workshop place?',
    ja: '体験講座の参加枠を確保するには、何をすればよいですか？',
    choices: [
      ['Call the museum on Friday.', '金曜日に博物館へ電話する。'],
      [
        'Complete the online form by Thursday.',
        '木曜日までにオンラインフォームに記入する。',
      ],
      ['Wait until Friday.', '金曜日まで待つ。'],
      ['Go directly to the garden.', '庭へ直接行く。'],
    ],
    answer: 1,
    evidence: 's3',
    skill: '予約方法と締切',
    explanation:
      'reserve a place と secure a place は、ここでは「参加枠を確保する」。方法はフォーム、期限は木曜日です。',
  },
  {
    en: 'Where will the workshop take place if the sky is cloudy?',
    ja: '曇りの場合、体験講座はどこで行われますか？',
    choices: [
      ['In the garden.', '庭で。'],
      ['At the café.', 'カフェで。'],
      ['Inside the museum.', '博物館の屋内で。'],
      ['Outside near the telescope.', '屋外の望遠鏡の近くで。'],
    ],
    answer: 2,
    evidence: 's4',
    skill: '条件による変更',
    explanation:
      'If the sky is cloudy が条件。move indoors は屋内への変更で、Inside the museum と対応します。',
  },
];
export const SENTENCES = PASSAGE.flatMap((section) => section.sentences);
export const normalizeWord = (word: string) =>
  word
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-zé0-9]/g, '');
