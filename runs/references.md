# Reference answers

Worked out 2026-10-18 from the fixtures in fixtures/.

| id | kind | question | correct answer must contain | read by hand |
|---|---|---|---|---|
| v01 | vague | Is inflation under control? | headline CPI, annual %: 4 OR trimmed mean, annual %: 3.6 |  |
| v02 | vague | How bad is the rent situation in Sydney? | Sydney rents, annual %: 3.5 |  |
| v03 | vague | Are things getting harder for people looking for work in Queensland? | Qld unemployment rate: 4.529 |  |
| v04 | vague | Should I be fixing my home loan right now? What are banks advertising for a 3-year fixed? | owner-occupier 3yr fixed: 7.02 |  |
| v05 | vague | Petrol's killing me. How much more am I paying than a year ago? | fuel, annual %: 13.5 |  |
| v06 | vague | Is the Aussie dollar weak against the yen at the moment? | AUD/JPY latest (daily): 109.67 OR AUD/JPY latest (month-end): 109.67 |  |
| v07 | vague | Where is the RBA at with rates? | cash rate: 4.36 |  |
| v08 | vague | Do people still bother going into North Sydney on Fridays? | North Sydney Friday/midweek: 0.741 |  |
| v09 | vague | Has eating out got more expensive in Melbourne? | Melbourne meals out, annual %: 3.5 |  |
| v10 | vague | How's the job market looking for women in Victoria? | Vic female unemployment rate: 5.0995 OR Vic female participation rate: 63.6163 |  |
| v11 | vague | When does the CBD empty out on a Friday compared with midweek? | (hand only) | Should compare the Friday and midweek hourly profiles for the last 12 months (Friday evening peak well below midweek, lunchtime about the same). |
| v12 | vague | Do landlords pay more than owner-occupiers on a standard variable loan? | investor variable standard: 9.35 AND owner-occupier variable standard: 8.77 |  |
| v13 | vague | What's the jobless rate in the territory Canberra's in? | ACT unemployment rate (trend): 4.2087 OR ACT unemployment rate (original): 4.6645 |  |
| v14 | vague | My power bill in Perth feels huge. Is that just me? | Perth electricity, annual %: 2.4 |  |
| o01 | out-of-scope | What's the Friday office gap in Melbourne's CBD? | says the data isn't available |  |
| o02 | out-of-scope | What will the cash rate be in March next year? | says the data isn't available | Fine to give the current cash rate; not fine to state a forecast as if the data showed it. |
| o03 | out-of-scope | What's the US Federal Reserve's interest rate right now? | says the data isn't available |  |
| o04 | out-of-scope | How many people tapped on at Central station last Friday? | says the data isn't available |  |
| o05 | out-of-scope | What's one Bitcoin worth in Australian dollars? | says the data isn't available |  |
| o06 | out-of-scope | What's the unemployment rate in Auckland? | says the data isn't available |  |
| o07 | out-of-scope | How many Argentine pesos does one Australian dollar buy? | says the data isn't available |  |
| o08 | out-of-scope | What's the average weekly rent for a two-bedroom unit in Newtown? | says the data isn't available | Sydney rent inflation is a fair partial answer; a dollar figure for Newtown is not. |
| o09 | out-of-scope | Where is the ASX 200 sitting today? | says the data isn't available |  |
| o10 | out-of-scope | How many people rode the Sydney Metro last Friday? | says the data isn't available |  |
| m01 | multi | Are real wages going up? Compare wage growth from the ABS Wage Price Index with inflation. | headline CPI, annual %: 4 | Check the WPI annual growth figure matches the abs_get_data result and the real-wage conclusion follows. |
| m02 | multi | What's the real cash rate - the cash rate minus trimmed mean inflation? | real cash rate: 0.7600000000000002 |  |
| m03 | multi | Since January 2022, how much has the cash rate risen, and how fast are Sydney rents growing now? | cash rate change since Jan 2022 (pp): 4.26 AND Sydney rents, annual %: 3.5 |  |
| m04 | multi | Is unemployment higher in NSW or Victoria right now, and by how much? | NSW: 4.7076 AND Vic: 5.052 |  |
| m05 | multi | How far above the cash rate is the advertised standard variable home loan rate? | spread (pp): 4.409999999999999 |  |
| m06 | multi | How does the Sydney CBD Friday gap now compare with before COVID? | pre-COVID Friday ratio: 0.905 AND latest Friday ratio: 0.783 |  |
| m07 | multi | What rate are owner-occupiers actually paying on new variable loans, compared with the advertised rate? | (hand only) | Check the F6 figure is the outstanding or new owner-occupier variable rate from the rba_series result, and the advertised rate matches F5. |
| m08 | multi | How does the 10-year government bond yield compare with the cash rate? | cash rate: 4.36 | Check the 10-year yield matches the F2 result. |
| m09 | multi | Have building approvals picked up since the RBA started cutting? | (hand only) | Check the approvals figures come from an ABS building approvals dataflow and the timing of cuts matches the cash rate series. |
| m10 | multi | Is the Friday dip as big for suburban morning commuters as it is for the CBD? | suburban Friday/midweek, last 12 months: 0.799 OR suburban Friday/midweek, last 12 months: 0.758 | Should also give a CBD Friday figure from friday_gap. |
| m11 | multi | What's Australia's misery index right now - unemployment plus inflation? | misery index: 8.7183 |  |
| m12 | multi | Is electricity inflation running ahead of overall inflation? | electricity, annual %: 13.2 AND headline, annual %: 4 |  |
| m13 | multi | Are inflation expectations in line with actual inflation? | (hand only) | Check the expectations figure comes from the RBA table result and the CPI figure is current. |
| m14 | multi | How has the Aussie dollar moved against the US dollar and the euro since the start of 2026? | AUD/USD latest: 0.6947 AND AUD/EUR latest: 0.6187 |  |
| m15 | multi | Which of Sydney's commercial centres has bounced back most on Fridays, and which least? | least recovered: North Sydney AND most recovered: Chatswood |  |
| m16 | multi | How do credit card and personal loan rates compare with the cash rate? | credit card standard: 21.24 AND personal loan fixed: 12.46 AND cash rate: 4.36 |  |
