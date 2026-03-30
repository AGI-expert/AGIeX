# Adding a Research Domain

This guide walks you through adding a new autonomous research domain to the
AGI.expert network. Every node in the network will pick up the new domain and
begin running experiments automatically.

## 1. Create the project directory

Copy the template and give your project a kebab-case name:

```bash
cp -r projects/_template projects/my-new-domain
```

Your directory should look like:

```
projects/my-new-domain/
├── README.md
├── LEADERBOARD.md
├── baseline/
│   ├── config.yaml
│   └── results.json
```

## 2. Write the README

Describe:
- **Objective** — what the domain optimizes for
- **Benchmarks** — how results are measured (with baseline values)
- **Composite score formula** — how individual benchmarks combine into one number
- **What to explore** — mutation ideas agents should try
- **Dataset** — where training data comes from

See `projects/general-intelligence/README.md` for a full example.

## 3. Define the baseline config

Edit `baseline/config.yaml` with the starting configuration. This is what
agents mutate from. Follow the standard YAML format used by other projects
(model, architecture, finetuning, training, data, benchmarks sections).

Requirements:
- Dataset must be downloadable or generatable by agents
- Baseline should train in **< 5 minutes** on a single GPU
- Config follows the standard TrainingScript YAML format

## 4. Record baseline results

Run the baseline config and save results to `baseline/results.json`:

```json
{
  "version": 1,
  "baseline": true,
  "model": "your-base-model",
  "benchmarks": {
    "benchmark_a": 0.35,
    "benchmark_b": 0.42
  },
  "composite_score": 0.385,
  "notes": "How the composite score is calculated"
}
```

## 5. Create an empty leaderboard

Create `LEADERBOARD.md` with headers matching your benchmarks. This file is
auto-updated every 6 hours by the network.

## 6. Register the domain in code

### a. `src/brain/agent.js`

Add your project name to the `RESEARCH_PROJECTS` array:

```js
const RESEARCH_PROJECTS = [
  // ... existing projects
  "my-new-domain",
];
```

Add a domain mapping in `projectToDomain()`:

```js
case "my-new-domain":
  return "mynewdomain";
```

Add a topic mapping in `projectToTopic()`:

```js
case "my-new-domain":
  return TOPICS.RESEARCH_ROUNDS; // or a new topic if needed
```

Add the domain to the `syncLeaderboards()` loop:

```js
for (const domain of ["research", "search", ..., "mynewdomain"]) {
```

### b. `src/research/pipeline.js`

Add domain-specific **mutations** to the `MUTATIONS` object:

```js
// ── My new domain mutations ──
my_param: (config) => {
  return deepSet(config, "some.param", pick([1, 2, 3]));
},
```

Add cases to these helper functions:

- `getMetricValue()` — return the primary metric from a result
- `getMetricDirection()` — `"asc"` if lower is better, `"desc"` if higher
- `getMetricName()` — display name for the metric
- `getFilePrefix()` — file prefix for saved experiment results

Add a simulation case in `simulateExperiment()`:

```js
case "my-new-domain": {
  // Simulate experiment based on config values
  const result = /* ... */;
  return { compositeScore: result, /* sub-benchmarks */ };
}
```

### c. `dashboard/index.html`

Add entries to:

- `DOMAIN_CONFIG` — display label, color, max, direction, format function
- `FIELD_MAP` — which result field to display

Add a leaderboard card in the HTML:

```html
<div class="card">
  <div class="card-title">My Domain Leaderboard (metric)</div>
  <table class="lb-table" id="lb-mynewdomain"><tbody></tbody></table>
</div>
```

## 7. Update counts

In `index.html`, update:
- The stat card showing the number of research projects
- Any text mentioning the project count (search for the old number)

## 8. Test locally

```bash
npm start
# Open http://localhost:3000/dashboard
# Verify the new domain appears and experiments run
```

## 9. Open a PR

Commit all changes and open a pull request. The network will pick up the new
domain once merged.
