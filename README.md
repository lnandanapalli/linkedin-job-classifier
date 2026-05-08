# LinkedIn Job Classifier

A Chrome extension that scans LinkedIn job listings and uses AI to classify them as **APPLY** or **SKIP** based on your personal profile like skills, experience, visa status, and custom blocklists.

Instead of manually reading through dozens of job descriptions, this extension clicks through every job card in the LinkedIn sidebar, extracts the full JD, sends it to an AI model for evaluation, and gives you a filterable dashboard of results.

## How it works

1. **Content script** (`content.js`) runs on LinkedIn's job search page. It finds all job cards in the sidebar, clicks each one to load the full job description, and extracts the text.

2. **Background service worker** (`background.js`) orchestrates the scanning process. It receives card data from the content script, sends each JD to the OpenAI API with a personalized classification prompt, and stores results. Scanning continues even if you close the popup.

3. **Popup** (`popup.js` / `popup.html`) is the dashboard. It polls the background for state and displays results with stats, filters, and click-to-navigate. All state (results, scroll position, active filter, clicked jobs) persists across popup opens/closes and browser restarts.

4. **Prompt builder** (`prompt-builder.js`) constructs the classification prompt from your personal profile (`profile.js`). The prompt uses hard skip rules (clearance requirements, experience thresholds, staffing firms, visa blockers) and skill inference logic to make binary APPLY/SKIP decisions.

## Features

- **Background scanning** — scan runs in the service worker, not the popup. Close and reopen freely.
- **Persistent results** — everything survives browser restarts via `chrome.storage.local`. Clear with the X button.
- **Stats bar** — fixed header showing Apply, Clicked, Pending, Viewed, and AI Skip counts.
- **Filters** — toggle between All, Apply, Viewed (already seen on LinkedIn), and AI Skip.
- **Click-to-navigate** — click any job row to scroll to and select that card on LinkedIn.
- **Force Scan** — re-scan all cards ignoring LinkedIn's Viewed/Saved/Applied status.
- **Scan This** — evaluate just the currently selected job without a full scan.
- **Duplicate-safe navigation** — occurrence counters handle multiple identical job titles on the same page.
- **Configurable profile** — all personal data lives in `profile.js`, not hardcoded in the extension.

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/lnandanapalli/linkedin-job-classifier.git
cd linkedin-job-classifier
```

### 2. Create your profile

```bash
cp profile.example.js profile.js
```

Open `profile.js` and fill in your details:

| Field | What it does |
|---|---|
| `name` | Your first name (used in the prompt for context) |
| `title` | Your professional title ("software engineer", "data scientist", etc.) |
| `education` | Degree and graduation date ("MS CS May 2025") |
| `degree` / `graduation_date` | Split versions of the above for specific prompt rules |
| `experience_years` | Years of experience ("2+", "1+", "5+") |
| `work_authorization` | Visa/work status ("US Citizen", "OPT EAD", "H1-B", etc.) |
| `location` | Location flexibility ("can relocate anywhere in the US") |
| `skills` | Array of your technical skills |
| `max_experience_years` | Auto-skip jobs requiring more than this many years |
| `blocklists` | Companies, staffing firms, aggregators, and platforms to auto-skip |
| `skill_inference_down` | Skills that imply simpler related skills (React implies JavaScript) |
| `skill_inference_up` | Skills the AI should NOT assume you have (Docker does not imply Kubernetes) |

### 3. Get an API key

You need an OpenAI API key. Get one at [platform.openai.com](https://platform.openai.com/api-keys).

### 4. Load the extension

1. Open `chrome://extensions/` in Chrome
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `linkedin-job-classifier` folder
5. The extension icon appears in your toolbar

### 5. Configure

1. Click the extension icon
2. Click **Edit** in the Settings section
3. Paste your OpenAI API key
4. Select a model (gpt-4.1-mini recommended for speed/cost balance)
5. Click **Save**

## Usage

1. Go to [LinkedIn Jobs](https://www.linkedin.com/jobs/) and run a search
2. Click the extension icon
3. Click **Scan All** to evaluate every job in the sidebar
4. Results stream in as each job is evaluated
5. Green dots = APPLY, Red dots = SKIP
6. Click any row to jump to that job on LinkedIn
7. Use filters to focus on Apply jobs or see what was skipped
8. **Force Scan** re-evaluates everything, ignoring Viewed/Saved status

## File structure

```
linkedin-job-classifier/
  manifest.json          Chrome extension manifest (MV3)
  background.js          Service worker: scan orchestration, API calls, state
  content.js             Content script: DOM interaction, card finding, JD extraction
  popup.html             Popup UI structure and styles
  popup.js               Popup logic: rendering, filters, stats, navigation
  prompt-builder.js      Constructs the AI prompt from profile data
  profile.js             Your personal profile (gitignored)
  profile.example.js     Example profile with dummy data
  options.html           Extension options page
  icons/                 Extension icons
  .gitignore
  README.md
```

## Models

| Model | Speed | Cost | Best for |
|---|---|---|---|
| `o4-mini` | Fast | Low | Reasoning, large batches |
| `o3` | Slower | Higher | When you want more careful reasoning |
| `gpt-4.1-mini` | Fast | Low | (Recommended) Non-reasoning, Efficient |

## How the classifier decides

The prompt follows a strict **default APPLY** philosophy. A job is only marked SKIP if it triggers one of these hard rules:

- Requires security clearance or US citizenship
- Posted by a defense/intelligence contractor
- Explicitly requires more years than your `max_experience_years`
- Posted by a staffing firm, job aggregator, or gig platform on your blocklist
- Explicitly blocks your visa type
- Part-time, talent pool, or internship (with exceptions)

If none of these trigger, the verdict is always APPLY — even if the skills aren't a perfect match. The reasoning is: it's better to see a mediocre match than to miss a good one.

## License

MIT
