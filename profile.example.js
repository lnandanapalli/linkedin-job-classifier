// ── Example profile. Copy this to profile.js and fill in your details. ──
// profile.js is gitignored so your personal info stays local.

const PROFILE = {
  // ── About you ──
  name: "Alex",
  title: "software engineer",
  education: "BS CS 2024",
  degree: "BS CS",
  graduation_date: "May 2024",
  experience_years: "1+",
  work_authorization: "US Citizen",                      // or "OPT EAD", "H1-B", "Green Card", etc.
  location: "can relocate anywhere in the US",           // or "based in NYC, not willing to relocate"

  // ── Your skills (used for matching and inference) ──
  skills: [
    "Python", "JavaScript", "TypeScript",
    "React", "Node.js", "Express",
    "PostgreSQL", "MongoDB",
    "Docker", "AWS", "Git", "CI/CD",
    "REST APIs", "GraphQL"
  ],

  // ── Skip jobs requiring more than this many years ──
  max_experience_years: 3,

  // ── Blocklists (companies/platforms to auto-skip) ──
  blocklists: {
    // Defense/intelligence contractors
    defense_contractors: [
      "Raytheon", "Lockheed Martin", "Northrop Grumman",
      "BAE Systems", "L3Harris", "Leidos", "Booz Allen Hamilton",
      "Palantir gov division", "General Dynamics", "SAIC"
    ],

    // Staffing firms and recruiters
    staffing_firms: [
      "CyberCoders", "Robert Half", "Insight Global",
      "Brooksource", "Addison Group"
    ],

    // Job aggregators (not real employers)
    job_aggregators: [
      "Dice", "Jobright", "Jobright.ai", "Lensa", "Turing"
    ],

    // Gig/annotation platforms
    gig_platforms: [
      "Data Annotation", "Mercor", "Alignerr", "Outlier", "Appen"
    ],

    // Companies often mistaken for defense (add any the AI keeps wrongly skipping)
    not_defense_companies: [
      "IBM", "Cisco", "Salesforce", "PwC"
    ]
  },

  // ── Skill inference rules ──
  // "Downward" = skills you have that cover related/simpler skills
  skill_inference_down: "React covers JavaScript and Node.js, TypeScript covers JavaScript, PostgreSQL covers MySQL and relational DBs, Docker covers containerization, AWS covers cloud basics",

  // "Upward" = things the AI should NOT assume you know based on what you have
  skill_inference_up: "Docker does not mean Kubernetes, Python does not mean Go or Rust, AWS does not mean GCP-specific services"
};
