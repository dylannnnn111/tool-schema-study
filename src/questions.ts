// 40 questions, harder than the 20 in aussie-data-mcp's own eval (which were written knowing the tools).
//   vague (14):        everyday wording the model has to turn into the right tool and arguments
//   out-of-scope (10): the data isn't there; the right answer says so instead of inventing a figure
//   multi (16):        needs two tools, or two series combined
//
// Right answers are worked out from the same fixtures the models see, by calling the canonical tool
// directly, so they can't drift from what the model was shown. A question with `hand` set has a part
// the scorer can't check automatically (e.g. a number from an ABS dataset found by search) - those
// answers are read by hand, and the automatic answer score only covers the rest.

export type Args = Record<string, unknown>;
/** Run a canonical tool call against the fixtures. */
export type Direct = (tool: string, args: Args) => Promise<unknown>;

/** text checks match anywhere unless `lead` is set, then only in the first 400 characters (the answer's headline, not a table further down). */
export interface Check { label: string; value?: number; tol?: number; text?: string; lead?: boolean }

export interface Question {
  id: string;
  kind: 'vague' | 'out-of-scope' | 'multi';
  q: string;
  /** Every tool listed must be called (a list inside the list = any one of those). */
  tools: (string | string[])[];
  /** Argument checks: for each tool, some successful call's canonical arguments must pass. */
  args?: Record<string, (a: Args) => boolean>;
  /** What a correct answer must contain. Returns alternatives: the answer passes if it satisfies every check in any one of them. */
  truth?: (d: Direct) => Promise<Check[][]>;
  /** Out of scope: a correct answer says the data isn't available (and doesn't invent it). */
  decline?: boolean;
  /** Part of the answer needs reading by hand - say what to look for. */
  hand?: string;
}

// ---------- helpers for reading tool results ----------

interface S { name: string; latest?: { period: string; value: number }; start?: { period: string; value: number }; change?: number; points: [string, number][] }
const series = (r: unknown): S[] => ((r as { series?: S[] })?.series ?? []);
const latestOf = async (d: Direct, tool: string, args: Args, i = 0) => {
  const s = series(await d(tool, args))[i];
  if (!s?.latest) throw new Error(`no data for ${tool} ${JSON.stringify(args)}`);
  return s.latest.value;
};
const named = async (d: Direct, tool: string, args: Args, part: string) => {
  const s = series(await d(tool, args)).find((x) => x.name.toLowerCase().includes(part.toLowerCase()));
  if (!s?.latest) throw new Error(`no series matching "${part}" in ${tool}`);
  return s.latest.value;
};
const num = (label: string, value: number, tol?: number): Check => ({ label, value, tol });
const lead = (label: string, text: string): Check => ({ label, text, lead: true });
const one = (...checks: Check[]): Check[][] => [checks];

const has = (field: string, ...values: string[]) => (a: Args) => values.every((v) => (a[field] as string[] | undefined)?.includes(v));
const is = (field: string, value: unknown) => (a: Args) => a[field] === value;
const all = (...ps: ((a: Args) => boolean)[]) => (a: Args) => ps.every((p) => p(a));

const CPI = (items: string[], cities = ['australia'], measure = 'annual_change') => ({ items, cities, measure });

export const QUESTIONS: Question[] = [
  // ---------------- vague ----------------
  {
    id: 'v01', kind: 'vague', q: 'Is inflation under control?',
    tools: ['get_cpi'],
    args: { get_cpi: (a) => a.measure === 'annual_change' && ((a.items as string[]).includes('all_groups') || (a.items as string[]).includes('trimmed_mean')) },
    truth: async (d) => [
      [num('headline CPI, annual %', await latestOf(d, 'get_cpi', CPI(['all_groups'])))],
      [num('trimmed mean, annual %', await latestOf(d, 'get_cpi', CPI(['trimmed_mean'])))],
    ],
  },
  {
    id: 'v02', kind: 'vague', q: 'How bad is the rent situation in Sydney?',
    tools: ['get_cpi'], args: { get_cpi: all(has('items', 'rents'), has('cities', 'sydney')) },
    truth: async (d) => one(num('Sydney rents, annual %', await latestOf(d, 'get_cpi', CPI(['rents'], ['sydney'])))),
  },
  {
    id: 'v03', kind: 'vague', q: 'Are things getting harder for people looking for work in Queensland?',
    tools: ['get_labour_force'], args: { get_labour_force: all(has('states', 'qld'), has('measures', 'unemployment_rate')) },
    truth: async (d) => one(num('Qld unemployment rate', await latestOf(d, 'get_labour_force', { measures: ['unemployment_rate'], states: ['qld'] }), 0.1)),
  },
  {
    id: 'v04', kind: 'vague', q: 'Should I be fixing my home loan right now? What are banks advertising for a 3-year fixed?',
    tools: ['get_lending_rates'], args: { get_lending_rates: has('rates', 'owner_occupier_3yr_fixed') },
    truth: async (d) => one(num('owner-occupier 3yr fixed', await latestOf(d, 'get_lending_rates', { rates: ['owner_occupier_3yr_fixed'] }))),
  },
  {
    id: 'v05', kind: 'vague', q: "Petrol's killing me. How much more am I paying than a year ago?",
    tools: ['get_cpi'], args: { get_cpi: all(has('items', 'automotive_fuel'), is('measure', 'annual_change')) },
    truth: async (d) => one(num('fuel, annual %', await latestOf(d, 'get_cpi', CPI(['automotive_fuel'])))),
  },
  {
    id: 'v06', kind: 'vague', q: 'Is the Aussie dollar weak against the yen at the moment?',
    tools: ['get_exchange_rates'], args: { get_exchange_rates: has('currencies', 'JPY') },
    truth: async (d) => [
      [num('AUD/JPY latest (daily)', await latestOf(d, 'get_exchange_rates', { currencies: ['JPY'], monthly: false }), 1.5)],
      [num('AUD/JPY latest (month-end)', await latestOf(d, 'get_exchange_rates', { currencies: ['JPY'] }), 1.5)],
    ],
  },
  {
    id: 'v07', kind: 'vague', q: 'Where is the RBA at with rates?',
    tools: ['get_cash_rate'],
    truth: async (d) => one(num('cash rate', await latestOf(d, 'get_cash_rate', {}))),
  },
  {
    id: 'v08', kind: 'vague', q: 'Do people still bother going into North Sydney on Fridays?',
    tools: ['get_commute_pulse'], args: { get_commute_pulse: all(is('view', 'friday_gap'), has('centres', 'North Sydney')) },
    truth: async (d) => one(num('North Sydney Friday/midweek', await latestOf(d, 'get_commute_pulse', { view: 'friday_gap', centres: ['North Sydney'] }))),
  },
  {
    id: 'v09', kind: 'vague', q: 'Has eating out got more expensive in Melbourne?',
    tools: ['get_cpi'], args: { get_cpi: all(has('items', 'meals_out'), has('cities', 'melbourne')) },
    truth: async (d) => one(num('Melbourne meals out, annual %', await latestOf(d, 'get_cpi', CPI(['meals_out'], ['melbourne'])))),
  },
  {
    id: 'v10', kind: 'vague', q: "How's the job market looking for women in Victoria?",
    tools: ['get_labour_force'], args: { get_labour_force: all(has('states', 'vic'), is('sex', 'females')) },
    truth: async (d) => [
      [num('Vic female unemployment rate', await latestOf(d, 'get_labour_force', { measures: ['unemployment_rate'], states: ['vic'], sex: 'females' }), 0.1)],
      [num('Vic female participation rate', await latestOf(d, 'get_labour_force', { measures: ['participation_rate'], states: ['vic'], sex: 'females' }), 0.1)],
    ],
  },
  {
    id: 'v11', kind: 'vague', q: 'When does the CBD empty out on a Friday compared with midweek?',
    tools: ['get_commute_pulse'], args: { get_commute_pulse: is('view', 'cbd_hourly') },
    hand: 'Should compare the Friday and midweek hourly profiles for the last 12 months (Friday evening peak well below midweek, lunchtime about the same).',
  },
  {
    id: 'v12', kind: 'vague', q: 'Do landlords pay more than owner-occupiers on a standard variable loan?',
    tools: ['get_lending_rates'], args: { get_lending_rates: has('rates', 'investor_variable_standard', 'owner_occupier_variable_standard') },
    truth: async (d) => one(
      num('investor variable standard', await latestOf(d, 'get_lending_rates', { rates: ['investor_variable_standard'] })),
      num('owner-occupier variable standard', await latestOf(d, 'get_lending_rates', { rates: ['owner_occupier_variable_standard'] })),
    ),
  },
  {
    id: 'v13', kind: 'vague', q: "What's the jobless rate in the territory Canberra's in?",
    tools: ['get_labour_force'], args: { get_labour_force: all(has('states', 'act'), has('measures', 'unemployment_rate')) },
    // ABS publishes no seasonally adjusted series for the ACT - the tool comes back empty and says to try original.
    // So this also tests recovery: trend or original both count.
    truth: async (d) => [
      [num('ACT unemployment rate (trend)', await latestOf(d, 'get_labour_force', { measures: ['unemployment_rate'], states: ['act'], adjustment: 'trend' }), 0.1)],
      [num('ACT unemployment rate (original)', await latestOf(d, 'get_labour_force', { measures: ['unemployment_rate'], states: ['act'], adjustment: 'original' }), 0.1)],
    ],
  },
  {
    id: 'v14', kind: 'vague', q: 'My power bill in Perth feels huge. Is that just me?',
    tools: ['get_cpi'], args: { get_cpi: all(has('items', 'electricity'), has('cities', 'perth')) },
    truth: async (d) => one(num('Perth electricity, annual %', await latestOf(d, 'get_cpi', CPI(['electricity'], ['perth'])))),
  },

  // ---------------- out of scope ----------------
  { id: 'o01', kind: 'out-of-scope', q: "What's the Friday office gap in Melbourne's CBD?", tools: [], decline: true },
  { id: 'o02', kind: 'out-of-scope', q: 'What will the cash rate be in March next year?', tools: [], decline: true,
    hand: 'Fine to give the current cash rate; not fine to state a forecast as if the data showed it.' },
  { id: 'o03', kind: 'out-of-scope', q: "What's the US Federal Reserve's interest rate right now?", tools: [], decline: true },
  { id: 'o04', kind: 'out-of-scope', q: 'How many people tapped on at Central station last Friday?', tools: [], decline: true },
  { id: 'o05', kind: 'out-of-scope', q: "What's one Bitcoin worth in Australian dollars?", tools: [], decline: true },
  { id: 'o06', kind: 'out-of-scope', q: "What's the unemployment rate in Auckland?", tools: [], decline: true },
  { id: 'o07', kind: 'out-of-scope', q: 'How many Argentine pesos does one Australian dollar buy?', tools: [], decline: true },
  { id: 'o08', kind: 'out-of-scope', q: "What's the average weekly rent for a two-bedroom unit in Newtown?", tools: [], decline: true,
    hand: 'Sydney rent inflation is a fair partial answer; a dollar figure for Newtown is not.' },
  { id: 'o09', kind: 'out-of-scope', q: 'Where is the ASX 200 sitting today?', tools: [], decline: true },
  { id: 'o10', kind: 'out-of-scope', q: 'How many people rode the Sydney Metro last Friday?', tools: [], decline: true },

  // ---------------- multi ----------------
  {
    id: 'm01', kind: 'multi', q: 'Are real wages going up? Compare wage growth from the ABS Wage Price Index with inflation.',
    tools: ['get_cpi', 'abs_get_data'],
    truth: async (d) => one(num('headline CPI, annual %', await latestOf(d, 'get_cpi', CPI(['all_groups'])))),
    hand: 'Check the WPI annual growth figure matches the abs_get_data result and the real-wage conclusion follows.',
  },
  {
    id: 'm02', kind: 'multi', q: "What's the real cash rate - the cash rate minus trimmed mean inflation?",
    tools: ['get_cash_rate', 'get_cpi'], args: { get_cpi: has('items', 'trimmed_mean') },
    truth: async (d) => {
      const cash = await latestOf(d, 'get_cash_rate', {});
      const tm = await latestOf(d, 'get_cpi', CPI(['trimmed_mean']));
      return one(num('real cash rate', cash - tm, 0.15));
    },
  },
  {
    id: 'm03', kind: 'multi', q: 'Since January 2022, how much has the cash rate risen, and how fast are Sydney rents growing now?',
    tools: ['get_cash_rate', 'get_cpi'], args: { get_cash_rate: (a) => typeof a.start === 'string' && a.start <= '2022-01', get_cpi: all(has('items', 'rents'), has('cities', 'sydney')) },
    truth: async (d) => {
      const s = series(await d('get_cash_rate', { start: '2022-01' }))[0];
      return one(num('cash rate change since Jan 2022 (pp)', s.change!, 0.1), num('Sydney rents, annual %', await latestOf(d, 'get_cpi', CPI(['rents'], ['sydney']))));
    },
  },
  {
    id: 'm04', kind: 'multi', q: 'Is unemployment higher in NSW or Victoria right now, and by how much?',
    tools: ['get_labour_force'], args: { get_labour_force: has('states', 'nsw', 'vic') },
    truth: async (d) => {
      const r = { measures: ['unemployment_rate'], states: ['nsw', 'vic'] };
      const nsw = await named(d, 'get_labour_force', r, 'New South Wales');
      const vic = await named(d, 'get_labour_force', r, 'Victoria');
      return one(num('NSW', nsw, 0.1), num('Vic', vic, 0.1));
    },
  },
  {
    id: 'm05', kind: 'multi', q: 'How far above the cash rate is the advertised standard variable home loan rate?',
    tools: ['get_lending_rates', 'get_cash_rate'], args: { get_lending_rates: has('rates', 'owner_occupier_variable_standard') },
    truth: async (d) => {
      const cash = await latestOf(d, 'get_cash_rate', {});
      const v = await latestOf(d, 'get_lending_rates', { rates: ['owner_occupier_variable_standard'] });
      return one(num('spread (pp)', v - cash, 0.1));
    },
  },
  {
    id: 'm06', kind: 'multi', q: 'How does the Sydney CBD Friday gap now compare with before COVID?',
    tools: ['get_commute_pulse'], args: { get_commute_pulse: is('view', 'baseline') },
    truth: async (d) => {
      const base = series(await d('get_commute_pulse', { view: 'baseline', centres: ['Sydney CBD'] }))[0].points.find((p) => p[0] === 'fri_vs_midweek')![1];
      return one(num('pre-COVID Friday ratio', base), num('latest Friday ratio', await latestOf(d, 'get_commute_pulse', { view: 'friday_gap', centres: ['Sydney CBD'] })));
    },
  },
  {
    id: 'm07', kind: 'multi', q: 'What rate are owner-occupiers actually paying on new variable loans, compared with the advertised rate?',
    tools: ['rba_series', 'get_lending_rates'], args: { rba_series: (a) => String(a.table).toLowerCase() === 'f6' },
    hand: 'Check the F6 figure is the outstanding or new owner-occupier variable rate from the rba_series result, and the advertised rate matches F5.',
  },
  {
    id: 'm08', kind: 'multi', q: "How does the 10-year government bond yield compare with the cash rate?",
    tools: ['rba_series', 'get_cash_rate'], args: { rba_series: (a) => String(a.table).toLowerCase() === 'f2' },
    truth: async (d) => one(num('cash rate', await latestOf(d, 'get_cash_rate', {}))),
    hand: 'Check the 10-year yield matches the F2 result.',
  },
  {
    id: 'm09', kind: 'multi', q: 'Have building approvals picked up since the RBA started cutting?',
    tools: ['abs_get_data', 'get_cash_rate'],
    hand: 'Check the approvals figures come from an ABS building approvals dataflow and the timing of cuts matches the cash rate series.',
  },
  {
    id: 'm10', kind: 'multi', q: 'Is the Friday dip as big for suburban morning commuters as it is for the CBD?',
    tools: ['get_commute_pulse'], args: { get_commute_pulse: is('view', 'suburban_morning') },
    truth: async (d) => {
      const sub = series(await d('get_commute_pulse', { view: 'suburban_morning' }));
      const last = sub.filter((s) => /last 12 months/.test(s.name)).map((s) => s.latest!.value);
      return last.map((v) => [num('suburban Friday/midweek, last 12 months', v)]);
    },
    hand: 'Should also give a CBD Friday figure from friday_gap.',
  },
  {
    id: 'm11', kind: 'multi', q: "What's Australia's misery index right now - unemployment plus inflation?",
    tools: ['get_labour_force', 'get_cpi'],
    truth: async (d) => {
      const u = await latestOf(d, 'get_labour_force', { measures: ['unemployment_rate'], states: ['australia'] });
      const p = await latestOf(d, 'get_cpi', CPI(['all_groups']));
      return one(num('misery index', u + p, 0.2));
    },
  },
  {
    id: 'm12', kind: 'multi', q: 'Is electricity inflation running ahead of overall inflation?',
    tools: ['get_cpi'], args: { get_cpi: has('items', 'electricity') },
    truth: async (d) => one(
      num('electricity, annual %', await latestOf(d, 'get_cpi', CPI(['electricity']))),
      num('headline, annual %', await latestOf(d, 'get_cpi', CPI(['all_groups']))),
    ),
  },
  {
    id: 'm13', kind: 'multi', q: 'Are inflation expectations in line with actual inflation?',
    tools: ['rba_series', 'get_cpi'], args: { rba_series: (a) => String(a.table).toLowerCase() === 'g1' || String(a.table).toLowerCase() === 'g3' },
    hand: 'Check the expectations figure comes from the RBA table result and the CPI figure is current.',
  },
  {
    id: 'm14', kind: 'multi', q: 'How has the Aussie dollar moved against the US dollar and the euro since the start of 2026?',
    tools: ['get_exchange_rates'], args: { get_exchange_rates: all(has('currencies', 'USD', 'EUR'), (a) => typeof a.start === 'string' && a.start <= '2026-01-31') },
    truth: async (d) => {
      const r = await d('get_exchange_rates', { currencies: ['USD', 'EUR'], monthly: false, start: '2026-01' });
      const [usd, eur] = series(r);
      return one(num('AUD/USD latest', usd.latest!.value, 0.01), num('AUD/EUR latest', eur.latest!.value, 0.01));
    },
  },
  {
    id: 'm15', kind: 'multi', q: "Which of Sydney's commercial centres has the busiest Fridays relative to midweek right now, and which the quietest?",
    tools: ['get_commute_pulse'], args: { get_commute_pulse: (a) => ((a.centres as string[] | undefined)?.length ?? 0) >= 4 },
    truth: async (d) => {
      const centres = ['Sydney CBD', 'North Sydney', 'Chatswood', 'Macquarie Park', 'Strathfield', 'Parramatta'];
      const s = series(await d('get_commute_pulse', { view: 'friday_gap', centres })).filter((x) => x.latest);
      s.sort((a, b) => a.latest!.value - b.latest!.value);
      return one(lead('quietest Fridays', s[0].name), lead('busiest Fridays', s[s.length - 1].name));
    },
  },
  {
    id: 'm16', kind: 'multi', q: 'How do credit card and personal loan rates compare with the cash rate?',
    tools: ['get_lending_rates', 'get_cash_rate'], args: { get_lending_rates: has('rates', 'credit_card_standard') },
    // The RBA stopped the fixed personal loan series in Feb 2020, so there's no current figure to check -
    // saying so is the right answer for that half. Only the credit card and cash rate figures are scored.
    truth: async (d) => one(
      num('credit card standard', await latestOf(d, 'get_lending_rates', { rates: ['credit_card_standard'] })),
      num('cash rate', await latestOf(d, 'get_cash_rate', {})),
    ),
    hand: 'Personal loan series ended Feb 2020 - the answer should say there is no current figure, not quote 12.46% as current.',
  },
];
