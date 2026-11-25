# Session handoff: 17 November 2026 (Week 1 analysis presentation + notebook)

This handoff is for the next agent. Read `AGENTS.md` and `PROJECT_CONTEXT.md` first. This file adds the detail of one session (10–17 November).

It is a dated snapshot. Check the actual files and Git status before acting. The user writes mostly in **Indonesian** and wants answers in Indonesian. The notebook is in Indonesian too.

## State in one paragraph

The Week 1 analysis (`outputs/week1-hypothesis-clustering-2026-11-10/`) was turned into three things:

1. a plain HTML report artifact;
2. a Data-type dashboard artifact, restructured as a 7-section technical outline for the user's professor;
3. a Jupyter notebook, `Week 1 Readings/Plots/week1_analysis.ipynb`, with literature limits (DOIs), peak/low labels, 3D plots, an insight story, explanations of the hourly table, and a Gradio dashboard cell.

All of it is **analysis only**. No firmware, device, cloud deployment, calibration or Git action took place. Nothing is committed.

## Why this work exists

The user's professor rejected an RH–MQ correlation slide with the words "how did you come to this? whats the algorithm used? you cant just look at the data graphs by eye". The user wants material that names the algorithm, the test and the result for every claim.

The user then asked for critical times to be explained with **published limits (with DOI)** rather than "unclear statistical lines". The last request was "coba diperjelasin di notebook nya biar dosen gw ngerti": make the notebook clear enough for the professor. That request is done.

## Deliverables

| What | Where | Status |
|---|---|---|
| Notebook (main deliverable) | `Week 1 Readings/Plots/week1_analysis.ipynb` | Rebuilt 17 Nov: 35 cells, 17 code cells, 0 errors, outputs embedded. Tracked file, modified, not committed. |
| Notebook builder | `Week 1 Readings/Plots/build_nb.py` | Copied out of the session scratchpad on 17 Nov. Untracked. **Edit this, not the .ipynb.** |
| Data dashboard artifact | https://claude.ai/artifact/1RYDBT6xKp4HGUQSHEjKki | Published, private. Page doc `files/index.html` is at version 3. |
| Plain HTML report artifact | https://claude.ai/artifact/TH3QuZH9wH7z8NkDwht8RG | Published, private. Earlier version, not restructured. |
| Artifact sources | `outputs/week1-artifact-sources-2026-11-11/` (ignored) | `dashboard/` holds the CSVs, index.html, markup/extra/methods_script fragments and make_csv.py. `html-report/` holds the plain report and its figures. |
| Analysis libs | `outputs/analysis-libs-20261110/` (ignored) | matplotlib, scipy and scikit-learn installed into this folder. The notebook adds it to `sys.path` automatically. |

### Rebuilding the notebook

Run from `Week 1 Readings/Plots`:

```bash
PYTHONIOENCODING=utf-8 python build_nb.py "$(pwd)" "C:/Users/Ando/Documents/Ando/bleh/Enrichment 2/outputs/analysis-libs-20261110"
```

What the builder does:

- It executes every cell in a shared namespace.
- It embeds matplotlib figures as PNG outputs, using a fake `display` function.
- It only syntax-checks cells marked `code_noexec`, which is the Gradio `gr.Blocks` cell.
- Data comes from `Week 1 Readings/coop-readings*.csv`.
- It ends with the line `wrote week1_analysis.ipynb: N cells, M code cells, K errors`. K must be 0.

Helpers inside the builder:

- `mark_daily` and `mark_peaks_lows` label each day's peak and low with the value and time.
- `mark_hourly` labels the highest and lowest hour.
- `extremes_table`.
- `transition_grid(hour)` draws 5-minute boxes per day.
- `crossings()` gives the first and last time THI ≥ 75 per day.

## Notebook outline (Indonesian section names)

1. Data loading: 127,678 eligible rows → 2,128 five-minute medians, each needing at least 54 of 60 readings. Range is 16 Oct 10:10 to 23 Oct 19:25 WIB.
2. Time series of every sensor with daily peak/low labels, plus a pressure/MQ extremes table.
3. Literature limits table and temp/RH/THI charts with limit bands, a % time table, and an extremes table.
4. **3A Insight:**
   - hourly profile;
   - hourly table with `n_hari` and `n_interval_5mnt`;
   - "Cara membaca tabel per jam" (the hour-9 = 42.9% explanation);
   - transition grids for hours 8, 9 and 10;
   - the crossings table;
   - day × hour heatmap;
   - per-day hours table;
   - the story "Cerita data Minggu 1".
5. Ammonia note.
6. Correlations: scatter plots with r, matrices, permutation test, sign test.
7. 3D plots (5.1–5.4).
8. Clustering: histogram and silhouette.
9. Gradio dashboard: the functions cell is executed, the `demo.launch` cell is **not**.
10. Conclusions.
11. References R1–R8 and datasheets.

## Key facts already explained to the user (do not re-derive)

### THI

- THI is computed from the **AHT20** temperature and RH. No separate sensor measures it.
- Formula (NRC 1971): THI = T_F − (0.55 − 0.0055·RH)(T_F − 58).
- Bands (Kim 2024, doi 10.3390/ani14071076, verified in full text): < 70 comfort, 70–75 alert, 76–81 danger, > 81 emergency. The notebook treats 75 as the start of danger.
- Sensor uncertainty gives about ±0.5 THI.

### Temperature

- 21–28 °C is a **comfort zone** (Apalowo 2024, doi 10.3390/poultry3020010). That number comes from search text and was **not verified in the full text**.
- Above 28 °C means "outside the comfort zone", not automatically "dangerous". The notebook uses THI for danger.

### Other limits

- RH 40–60% comes from UGA extension and has **no DOI**.
- NH3 < 25 ppm comes from Bist 2023 (doi 10.1016/j.jenvman.2022.116919), via a secondary citation. It cannot be applied to MQ-135, which gives relative mV, not ppm.

### Hourly table

- The table pools all days. Hours 0–9 and 20–23 have 7 days (84 intervals). Hours 10–18 have 8 days (94–96 intervals).
- `pct_*` is the share of 5-minute intervals in that hour that are above the limit.
- **Hour 9 = 36 of 84 = 42.9%.** Per day:

  | 17 Oct | 18 Oct | 19 Oct | 20 Oct | 21 Oct | 22 Oct | 23 Oct |
  |---|---|---|---|---|---|---|
  | 2/12 | 2/12 | 0/12 | 8/12 | 9/12 | 8/12 | 7/12 |

- Hour 9 is the transition hour where THI crosses 75: at 09:50 on 17–18 Oct and at 09:10–09:20 from 20 Oct.
- The `mq_median_stabil` column uses 18–23 Oct only.

### Critical times

- Temperature is above 28 °C about 10:00–17:30 every day. Peaks are 29.8–31.3 °C at 12:50–14:15. Lows are 22.0–23.7 °C at 04:35–06:10.
- THI ≥ 75 lasts about 6–12 h a day. The maximum is 79.0, so THI never reaches emergency.
- RH is above 60% most nights (19:00–07:00).
- Settled MQ is lowest at midday (730–736 mV) and highest at 21:00–02:00 (up to 758 mV).
- THI and MQ are not correlated (r ≈ −0.03), so heat risk and gas-response risk fall in **separate windows**.

### Statistics behind the professor outline

- RH effect on 30-minute changes: r = +0.175. Circular-shift permutation (5,000 shifts of at least 6 h) gives p < 0.001.
- Temperature: p = 0.36.
- Event study: 7/7 humidity rises were followed by an MQ rise, p = 0.003.
- Within-day OLS: +0.64 mV/%RH (CI 0.37–0.89).
- Clustering:
  - k-means k = 2 puts the boundary at 656 mV (silhouette 0.81).
  - k-means k = 3 on 18–23 Oct gives 729.4 and 753.7 mV.
  - Validation used GMM/BIC, leave-one-day-out, day bootstrap and humidity-compensated clustering.
  - These are **proposals**, not applied thresholds, and they do not transfer to `mq135-02`.

## Open items (offered, not requested yet)

1. **Wording fix:** story point 1 in "Cerita data Minggu 1" still calls > 28 °C a "jendela stres panas". The user's own question showed that 28 °C is the comfort-zone edge. The suggested wording is "di atas zona nyaman", with danger argued from THI. It would also help to verify Apalowo's 21–28 °C in the full text (the MDPI site returned 403 to automated fetches).
2. **Gradio:** it is not installed and the cell is untested. Install it into the user's Jupyter environment or `outputs/analysis-libs-20261110`, then run the cell. Ask first, because this is a package install.
3. The dashboard artifact still carries the unused `checks` dataset. Removal was offered and not requested.
4. Git: the modified `PROJECT_CONTEXT.md`, `VERIFICATION.md` and `week1_analysis.ipynb`, plus the untracked `build_nb.py` and this handoff, are uncommitted. Commit only on request.

## Gotchas

- Git reports dubious ownership. Use `git -c safe.directory="C:/Users/Ando/Documents/Ando/bleh/Enrichment 2" ...` and do not change global config.
- Windows console: set `PYTHONIOENCODING=utf-8`, otherwise printing °, ≥ and similar characters fails with cp1252.
- Crossref sometimes returns 429. Retry before concluding that a DOI is bad.
- Keep "relative gas response (mV)" wording everywhere. Never call MQ-135 readings ammonia or ppm.
