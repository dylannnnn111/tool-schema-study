// The ten Aussie Data MCP tools in one neutral form. Every schema variant is generated from this,
// and every variant's arguments are turned back into the same canonical call, so the only thing that
// changes between variants is what the model sees.
import { CPI_CITIES, CPI_ITEMS, CPI_MEASURES, LF_MEASURES, LF_STATES, absDataUrl, absFetch, describeDataflow, getCpi, getLabourForce, nameSeries, searchDataflows } from './data/abs.ts';
import { CENTRES, getCommutePulse } from './data/commute.ts';
import { CURRENCIES, LENDING_RATES, getCashRate, getExchangeRates, getLendingRates, rbaSeries } from './data/rba.ts';

export type ParamType = 'string' | 'string[]' | 'boolean' | 'integer';

/** Where a parameter sits in the nested variant. "top" stays at the top level. */
export type Group = 'top' | 'select' | 'period' | 'options';

export interface Param {
  name: string;
  type: ParamType;
  description?: string; // the published description (dropped in the terse-descriptions variant)
  enum?: readonly string[]; // allowed values (dropped from the schema in the no-enums variant, still enforced by the server)
  default?: unknown;
  required?: boolean;
  pattern?: RegExp; // checked by the server in every variant
  patternHint?: string;
  min?: number;
  max?: number;
  group: Group;
}

export interface ToolSpec {
  name: string;
  description: string; // as published in aussie-data-mcp 0.1.0
  short: string; // one line, for the terse-descriptions variant
  params: Param[];
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

const PERIOD = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const start: Param = { name: 'start', type: 'string', group: 'period', pattern: PERIOD, patternHint: 'YYYY, YYYY-MM or YYYY-MM-DD', description: 'Earliest period, YYYY-MM (e.g. 2022-01). Omit for the full history.' };
const end: Param = { name: 'end', type: 'string', group: 'period', pattern: PERIOD, patternHint: 'YYYY, YYYY-MM or YYYY-MM-DD', description: 'Latest period, YYYY-MM. Omit for up to the latest release.' };
const keys = (o: Record<string, unknown>) => Object.keys(o);

export const TOOLS: ToolSpec[] = [
  {
    name: 'get_cpi',
    description:
      'Australian inflation from the ABS monthly Consumer Price Index, by item and capital city. ' +
      "Use measure 'annual_change' for 'what is inflation' (year-on-year %), 'monthly_change' for month-on-month %, 'index' for price levels. " +
      "The RBA's preferred underlying measure is trimmed_mean. For rent inflation use item 'rents'. " +
      "Other items can be passed as an ABS CPI index code (find codes with abs_describe_dataflow on 'CPI').",
    short: 'ABS consumer price index.',
    params: [
      // items is free text in the published server too (it also takes raw ABS codes), so it never has an enum
      { name: 'items', type: 'string[]', group: 'select', default: ['all_groups'], description: `One or more of: ${keys(CPI_ITEMS).join(', ')} - or a raw ABS CPI index code.` },
      { name: 'cities', type: 'string[]', group: 'select', enum: keys(CPI_CITIES), default: ['australia'], description: "Capital cities, or 'australia' for the weighted average of the eight capitals." },
      { name: 'measure', type: 'string', group: 'options', enum: keys(CPI_MEASURES), default: 'annual_change' },
      { name: 'adjustment', type: 'string', group: 'options', enum: ['original', 'seasonally_adjusted'], default: 'original', description: 'Falls back to whatever ABS publishes (trimmed mean is seasonally adjusted only).' },
      start, end,
    ],
    run: (a) => getCpi(a as never),
  },
  {
    name: 'get_labour_force',
    description:
      'ABS Labour Force survey, monthly: unemployment rate, participation, employment and more, for Australia or any state/territory. ' +
      'Rates are in %, counts are in thousands of people. Seasonally adjusted by default, which is what news reports quote.',
    short: 'ABS labour force data.',
    params: [
      { name: 'measures', type: 'string[]', group: 'select', enum: keys(LF_MEASURES), default: ['unemployment_rate'] },
      { name: 'states', type: 'string[]', group: 'select', enum: keys(LF_STATES), default: ['australia'] },
      { name: 'sex', type: 'string', group: 'select', enum: ['persons', 'males', 'females'], default: 'persons' },
      { name: 'adjustment', type: 'string', group: 'options', enum: ['seasonally_adjusted', 'trend', 'original'], default: 'seasonally_adjusted' },
      start, end,
    ],
    run: (a) => getLabourForce(a as never),
  },
  {
    name: 'get_cash_rate',
    description: "The Reserve Bank of Australia cash rate target, monthly average (% per year). Use for 'what's the cash rate', rate hikes/cuts over time, or to line up rates against CPI, rents or jobs.",
    short: 'RBA cash rate.',
    params: [start, end],
    run: (a) => getCashRate(a as never),
  },
  {
    name: 'get_lending_rates',
    description: 'RBA indicator lending rates (advertised, % per year), monthly: home loans for owner-occupiers and investors (variable standard, variable discounted, 3-year fixed), small business, credit cards and personal loans.',
    short: 'RBA lending rates.',
    params: [
      { name: 'rates', type: 'string[]', group: 'select', enum: keys(LENDING_RATES), default: ['owner_occupier_variable_discounted'] },
      start, end,
    ],
    run: (a) => getLendingRates(a as never),
  },
  {
    name: 'get_exchange_rates',
    description: 'Australian dollar exchange rates from the RBA (units of foreign currency per A$1), plus the trade-weighted index (TWI). Daily data from 2023; monthly (last value of each month) by default.',
    short: 'AUD exchange rates.',
    params: [
      { name: 'currencies', type: 'string[]', group: 'select', enum: CURRENCIES, default: ['USD'] },
      { name: 'monthly', type: 'boolean', group: 'options', default: true, description: 'false returns every trading day.' },
      start, end,
    ],
    run: (a) => getExchangeRates(a as never),
  },
  {
    name: 'rba_series',
    description:
      "Fallback for RBA data the focused tools don't cover (e.g. f6 actual lending rates, f2 bond yields, g1 inflation expectations, d1 credit growth). " +
      'Call with just `table` to list its series, then again with `series` ids (or a `search` phrase) to get the data.',
    short: 'Any RBA table.',
    params: [
      { name: 'table', type: 'string', group: 'top', required: true, description: 'RBA table id as on rba.gov.au/statistics/tables, e.g. f6, f2, g1, d1.' },
      { name: 'series', type: 'string[]', group: 'select', description: 'Series IDs from the table\'s list, e.g. FILRHLBVS.' },
      { name: 'search', type: 'string', group: 'select', description: "Words that must all appear in the series title, e.g. 'owner-occupier variable'." },
      { name: 'monthly', type: 'boolean', group: 'options', default: false, description: 'Collapse daily/weekly series to month-end.' },
      start, end,
    ],
    run: (a) => rbaSeries(a as never),
  },
  {
    name: 'get_commute_pulse',
    description:
      'How Sydney is commuting since COVID, from TfNSW Opal tap data (Commute Pulse). ' +
      "'friday_gap' = Friday evening tap-ons as a share of Tue-Thu, monthly since 2020 - the core return-to-office measure (1.0 = no gap). " +
      "Also: 'monday_gap', 'evening_volume' (Tue-Thu evening tap-ons per day), 'baseline' (pre-COVID ratios), 'cbd_hourly' (CBD tap-ons by hour, pre-COVID vs last 12 months), 'suburban_morning' (Friday vs midweek 7-9am outside the centres).",
    short: 'Sydney Opal commuting data.',
    params: [
      { name: 'view', type: 'string', group: 'select', enum: ['friday_gap', 'monday_gap', 'evening_volume', 'baseline', 'cbd_hourly', 'suburban_morning'], default: 'friday_gap' },
      { name: 'centres', type: 'string[]', group: 'select', enum: CENTRES, description: 'Commercial centres. Default Sydney CBD.' },
      start, end,
    ],
    run: (a) => getCommutePulse(a as never),
  },
  {
    name: 'abs_search_dataflows',
    description: "Search the ABS Data API catalogue (1,000+ datasets) by keyword. Use when CPI and Labour Force don't cover the question - e.g. wages, building approvals, population, retail trade, GDP. Returns dataflow ids for abs_describe_dataflow.",
    short: 'Search ABS datasets.',
    params: [{ name: 'query', type: 'string', group: 'top', required: true, min: 2, description: "Keywords, e.g. 'wage price index' or 'building approvals'." }],
    run: async (a) => ({ results: await searchDataflows(a.query as string) }),
  },
  {
    name: 'abs_describe_dataflow',
    description: "List an ABS dataflow's dimensions (in key order) and their codes, so you can build an SDMX key for abs_get_data. Use `code_search` to find codes in big codelists (e.g. 'rent' in CPI's INDEX).",
    short: 'Describe an ABS dataset.',
    params: [
      { name: 'dataflow', type: 'string', group: 'top', required: true, description: 'Dataflow id, e.g. WPI, CPI, LF, BA_GCCSA.' },
      { name: 'code_search', type: 'string', group: 'options', description: 'Only return codes whose label contains this text.' },
    ],
    run: async (a) => {
      const search = a.code_search as string | undefined;
      const d = await describeDataflow(a.dataflow as string, search ? 10_000 : 60);
      if (search) {
        const s = search.toLowerCase();
        for (const dim of d.dimensions) dim.codes = dim.codes.filter((c) => c.label.toLowerCase().includes(s) || c.code.toLowerCase() === s).slice(0, 60);
      }
      return { ...d, howToBuildKey: "Join one code per dimension with '.', in this order. Use '+' for several codes (1+2) and leave a dimension empty for all codes (1..50.M)." };
    },
  },
  {
    name: 'abs_get_data',
    description: 'Fetch any ABS dataflow with an SDMX key from abs_describe_dataflow. Keep keys narrow - an empty key on a big dataflow returns thousands of series. Use last_n to just get the latest values.',
    short: 'Get ABS data.',
    params: [
      { name: 'dataflow', type: 'string', group: 'top', required: true },
      { name: 'key', type: 'string', group: 'top', required: true, description: "SDMX key, e.g. '3.10001.10.50.M'. Use 'all' only with last_n on small dataflows." },
      { name: 'last_n', type: 'integer', group: 'options', min: 1, max: 500, description: 'Only the last N observations per series.' },
      start, end,
    ],
    run: async (a) => {
      const q = { dataflow: a.dataflow as string, key: a.key as string, startPeriod: a.start as string | undefined, endPeriod: a.end as string | undefined, lastN: a.last_n as number | undefined };
      const raw = await absFetch(q);
      if (raw.length > 40) throw new Error(`That key matches ${raw.length} series - too many to return. Narrow it (pin more dimensions).`);
      const { series, notes } = nameSeries(raw);
      if (!series.length) notes.push('No data for that key. Check codes with abs_describe_dataflow.');
      return { source: `ABS ${a.dataflow}`, sourceUrl: absDataUrl(q), series, notes };
    },
  },
];

export const toolByName = new Map(TOOLS.map((t) => [t.name, t]));
