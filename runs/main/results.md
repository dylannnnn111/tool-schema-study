# Tool Schema Study - main

1200 cells: 5 variants x 3 models (haiku-5-5, opus-5-5, sonnet-5-5) x 40 questions, 2 run(s). Total cost $22.01.

Values are averaged per question (over runs and models), then over questions. Brackets are 95% bootstrap intervals over questions. * = sign test p < 0.05 against baseline.

## Variants, all models together

| Variant | Right answer | Right tools | Right arguments | Rejected calls per question | Recovered after an error | Tool calls per question | Cost per question ($) |
|---|---|---|---|---|---|---|---|
| baseline | 99% | 100% | 100% | 0.01 | 67% | 2.32 | 0.0183 |
| terse-descriptions | 100% | 99% | 89% | 0.04 | 89% | 2.61 | 0.0182 |
| no-enums | 100% | 100% | 100% | 0.21 | 89% | 2.52 | 0.0184 |
| nested | 100% | 100% | 100% | 0.01 | 100% | 2.32 | 0.0181 |
| terse-errors | 100% | 100% | 100% | 0.00 | 100% | 2.33 | 0.0187 |

## Change from baseline

| Variant | Right answer | Right arguments | Rejected calls per question | Recovered after an error |
|---|---|---|---|---|
| terse-descriptions | +1 pts [0, 2] | -11 pts [-21, -3] | +0.02 [0.00, 0.05] | -17 pts [-33, 0] |
| no-enums | +0 pts [-1, 2] | +0 pts [0, 0] | +0.20 [0.08, 0.33] * | +0 pts [0, 0] |
| nested | +0 pts [-1, 2] | +0 pts [0, 0] | -0.00 [-0.03, 0.02] | +0 pts [0, 0] |
| terse-errors | +1 pts [0, 2] | +0 pts [0, 0] | -0.01 [-0.04, 0.00] | +0 pts [0, 0] |

## Right answer, by model

| Variant | haiku-5-5 | opus-5-5 | sonnet-5-5 |
|---|---|---|---|
| baseline | 99% | 100% | 99% |
| terse-descriptions | 100% | 100% | 100% |
| no-enums | 100% | 99% | 100% |
| nested | 100% | 99% | 100% |
| terse-errors | 100% | 100% | 100% |

## Right arguments, by model

| Variant | haiku-5-5 | opus-5-5 | sonnet-5-5 |
|---|---|---|---|
| baseline | 100% | 100% | 100% |
| terse-descriptions | 81% | 92% | 94% |
| no-enums | 100% | 100% | 100% |
| nested | 100% | 100% | 100% |
| terse-errors | 100% | 100% | 100% |

## Rejected calls per question, by model

| Variant | haiku-5-5 | opus-5-5 | sonnet-5-5 |
|---|---|---|---|
| baseline | 0.01 | 0.00 | 0.03 |
| terse-descriptions | 0.07 | 0.01 | 0.03 |
| no-enums | 0.23 | 0.16 | 0.24 |
| nested | 0.00 | 0.00 | 0.03 |
| terse-errors | 0.00 | 0.00 | 0.00 |

## Recovered after an error, by model

| Variant | haiku-5-5 | opus-5-5 | sonnet-5-5 |
|---|---|---|---|
| baseline | 50% | 100% | 100% |
| terse-descriptions | 50% | 100% | 100% |
| no-enums | 100% | 100% | 88% |
| nested | - | 100% | 100% |
| terse-errors | - | 100% | - |

## Right answer, by question type

| Variant | vague | out-of-scope | multi |
|---|---|---|---|
| baseline | 100% | 97% | 100% |
| terse-descriptions | 100% | 100% | 100% |
| no-enums | 100% | 98% | 100% |
| nested | 100% | 98% | 100% |
| terse-errors | 100% | 100% | 100% |

## What the variants were

- **baseline**: Schemas as published: full descriptions, enums, flat arguments, helpful errors
- **terse-descriptions**: One-line tool descriptions, no parameter descriptions
- **no-enums**: Enums removed from the schema (the server still only accepts the same values)
- **nested**: Arguments grouped into select / period / options objects
- **terse-errors**: Error messages say only that the call failed, not why

## Most common rejected arguments

**baseline**: abs_get_data start: "..." should be YYYY, YYYY-MM or YYYY-MM-DD (3)

**terse-descriptions**: abs_get_data start: "..." should be YYYY, YYYY-MM or YYYY-MM-DD (4); rba_series last_n: unknown argument (4); get_cpi start: "..." should be YYYY, YYYY-MM or YYYY-MM-DD (1)

**no-enums**: get_commute_pulse centres: "..." isn't a valid value (46); get_labour_force states: "..." isn't a valid value (19); get_lending_rates rates: "..." isn't a valid value (17); get_labour_force measures: "..." isn't a valid value (17); get_exchange_rates currencies: "..." isn't a valid value (8); get_labour_force sex: "..." isn't a valid value (2)

**nested**: rba_series search: unknown argument (2)

**terse-errors**: none
