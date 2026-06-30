/* =========================================================
   Penn Square Digital — Audit Planner
   Wizard, scoring, recommendations, gamification
   ========================================================= */

(function () {
  'use strict';

  /* -------------------- STATE -------------------- */
  const TOTAL_STEPS = 7;
  let currentStep = 1;
  let answers = {};
  let recommendations = [];
  let completedIds = new Set();
  let activeFilter = 'all';

  /* -------------------- DOM HELPERS -------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* -------------------- ANIMATED LEAK COUNTERS -------------------- */
  function animateCountersOnScroll() {
    const counters = $$('.count');
    if (!counters.length) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !entry.target.dataset.animated) {
          entry.target.dataset.animated = 'true';
          const target = parseInt(entry.target.dataset.to, 10);
          const duration = 1400;
          const start = performance.now();
          const tick = (now) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            entry.target.textContent = Math.floor(eased * target);
            if (progress < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      });
    }, { threshold: 0.4 });

    counters.forEach((c) => observer.observe(c));
  }

  /* -------------------- WIZARD: STEP DOTS -------------------- */
  function buildStepDots() {
    const row = $('#wizardStepsRow');
    if (!row) return;
    row.innerHTML = '';
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      const dot = document.createElement('span');
      dot.className = 'step-dot';
      if (i === currentStep) dot.classList.add('active');
      if (i < currentStep) dot.classList.add('complete');
      row.appendChild(dot);
    }
  }

  /* -------------------- WIZARD: SHOW STEP -------------------- */
  function showStep(step, opts = {}) {
    $$('.step').forEach((s) => s.classList.remove('active'));
    const target = $(`.step[data-step="${step}"]`);
    if (target) target.classList.add('active');

    $('#currentStepNum').textContent = step;
    $('#totalStepsNum').textContent = TOTAL_STEPS;
    const pct = Math.round((step / TOTAL_STEPS) * 100);
    $('#wizardBarFill').style.width = pct + '%';
    $('#wizardPercent').textContent = pct + '% complete';

    $('#prevBtn').disabled = step === 1;
    $('#nextBtn').hidden = step === TOTAL_STEPS;
    $('#finishBtn').hidden = step !== TOTAL_STEPS;

    buildStepDots();

    // Only scroll when navigating between steps, not on initial render
    if (opts.scrollIntoView) {
      const wizard = $('.wizard');
      if (wizard) {
        const rect = wizard.getBoundingClientRect();
        if (rect.top < 0 || rect.top > window.innerHeight * 0.4) {
          wizard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }
  }

  /* -------------------- WIZARD: VALIDATE STEP -------------------- */
  function validateStep(step) {
    const fieldset = $(`.step[data-step="${step}"]`);
    if (!fieldset) return true;

    let valid = true;
    const fields = $$('input[required], select[required]', fieldset);

    // Group radios by name so we only need one checked per group
    const radioGroups = new Set();
    fields.forEach((field) => {
      if (field.type === 'radio') {
        radioGroups.add(field.name);
      }
    });

    // Clear errors first
    $$('.field-error', fieldset).forEach((e) => e.classList.remove('show'));
    $$('input, select', fieldset).forEach((i) => i.classList.remove('invalid'));

    // Validate radio groups
    radioGroups.forEach((name) => {
      const checked = $$(`input[name="${name}"]`, fieldset).some((r) => r.checked);
      if (!checked) {
        valid = false;
        const err = $(`.field-error[data-for="${name}"]`, fieldset);
        if (err) err.classList.add('show');
      }
    });

    // Validate inputs & selects
    fields.forEach((field) => {
      if (field.type === 'radio') return;
      const value = field.value.trim();
      if (!value) {
        valid = false;
        field.classList.add('invalid');
        const err = $(`.field-error[data-for="${field.name}"]`, fieldset);
        if (err) err.classList.add('show');
      } else if (field.type === 'url') {
        const ok = /^([a-z0-9-]+\.)+[a-z]{2,}.*$/i.test(value) || /^https?:\/\//i.test(value);
        if (!ok) {
          valid = false;
          field.classList.add('invalid');
          const err = $(`.field-error[data-for="${field.name}"]`, fieldset);
          if (err) err.classList.add('show');
        }
      }
    });

    return valid;
  }

  /* -------------------- WIZARD: COLLECT ANSWERS -------------------- */
  function collectAnswers() {
    const form = $('#auditForm');
    const data = {};
    const fd = new FormData(form);

    // Strings & radios
    for (const [k, v] of fd.entries()) {
      if (data[k]) {
        if (Array.isArray(data[k])) data[k].push(v);
        else data[k] = [data[k], v];
      } else {
        data[k] = v;
      }
    }

    // Ensure checkbox arrays are arrays
    ['trustSignals', 'priorities'].forEach((name) => {
      if (data[name] && !Array.isArray(data[name])) data[name] = [data[name]];
      if (!data[name]) data[name] = [];
    });

    return data;
  }

  /* -------------------- SCORING -------------------- */
  // Returns score 0-100 for each category based on answers
  function scoreCategories(a) {
    const cats = {
      clarity: 50,
      mobile: 50,
      performance: 50,
      trust: 50,
      seo: 50,
    };

    // CLARITY
    const clarityMap = { yes: 100, partly: 65, no: 25, unsure: 45 };
    cats.clarity = clarityMap[a.clarityFiveSec] ?? 50;
    const ctaMap = { yes: 100, below: 60, generic: 35, none: 15 };
    cats.clarity = Math.round((cats.clarity + (ctaMap[a.ctaVisible] ?? 50)) / 2);

    // MOBILE
    const tapMap = { yes: 100, sometimes: 60, zoom: 30, bad: 10 };
    const feel = parseInt(a.mobileFeel || '5', 10);
    const callMap = { yes: 100, no: 55, none: 25 };
    const tapScore = tapMap[a.mobileTaps] ?? 50;
    const feelScore = feel * 10;
    const callScore = callMap[a.mobileTapCall] ?? 50;
    cats.mobile = Math.round((tapScore + feelScore + callScore) / 3);

    // PERFORMANCE
    const loadMap = { fast: 100, ok: 75, slow: 35, painful: 10 };
    const respMap = { instant: 100, laggy: 55, frozen: 20 };
    const shiftMap = { never: 100, sometimes: 60, lots: 25 };
    cats.performance = Math.round(
      ((loadMap[a.loadTime] ?? 50) + (respMap[a.responsiveness] ?? 50) + (shiftMap[a.layoutShift] ?? 50)) / 3
    );

    // TRUST
    const sslMap = { secure: 100, warning: 5, unsure: 50 };
    const signalsCount = (a.trustSignals || []).length;
    const signalsScore = Math.min(100, signalsCount * 18);
    cats.trust = Math.round(((sslMap[a.ssl] ?? 50) + signalsScore) / 2);

    // SEO
    const rankMap = { first: 100, firstPage: 75, buried: 35, nowhere: 10 };
    const gbpMap = { active: 100, stale: 55, never: 25, unsure: 30 };
    const updateMap = { recent: 100, thisYear: 75, aWhile: 35, never: 15 };
    cats.seo = Math.round(
      ((rankMap[a.searchRank] ?? 50) + (gbpMap[a.gbp] ?? 50) + (updateMap[a.lastUpdate] ?? 50)) / 3
    );

    // Clamp
    Object.keys(cats).forEach((k) => {
      cats[k] = Math.max(0, Math.min(100, cats[k]));
    });

    return cats;
  }

  function compositeScore(cats) {
    // Weighted: SEO 30, Content/Clarity 25, Mobile 20, UX/Performance 15, Trust 10
    const w = {
      seo: 0.30,
      clarity: 0.25,
      mobile: 0.20,
      performance: 0.15,
      trust: 0.10,
    };
    return Math.round(
      cats.seo * w.seo + cats.clarity * w.clarity + cats.mobile * w.mobile +
      cats.performance * w.performance + cats.trust * w.trust
    );
  }

  /* -------------------- INDUSTRY CONTEXT -------------------- */
  // Benchmark data sourced from the Penn Square Digital research file
  // (industry conversion benchmarks, mobile share, session duration, drop-off points)
  const INDUSTRIES = {
    'Restaurant or cafe': {
      description: 'a restaurant or cafe',
      pluralNoun: 'restaurants',
      intent: 'people deciding where to eat right now, often standing outside on a phone',
      ctaExamples: '"See the menu", "Reserve a table", or "Order online"',
      trustExamples: 'real photos of your food and space, current hours, and named reviews mentioning specific dishes',
      benchmarks: {
        avgConversion: '4.6% to 5.8%',
        topQuartile: '7.2% or higher',
        mobileShare: '80% to 85%',
        sessionDuration: '2 minutes 47 seconds',
        dropOff: 'Menu page loads and the online ordering checkout',
        tactics: 'Use responsive HTML menus instead of slow PDFs, and simplify online ordering checkouts.',
      },
      perRec: {
        'cta-missing': 'For a restaurant or cafe, the highest converting calls to action are usually "See the menu", "Reserve a table", or "Order online".',
        'mobile-tap': 'Most diners pull up restaurant sites on a phone while standing outside. A tap friendly menu and a tap to call number are the baseline.',
        'trust-thin': 'Real photography of your food and your space, plus named reviews mentioning specific dishes, are the trust signals diners actually look for.',
        'stale-content': 'An outdated menu or wrong hours sends visitors to the next listing immediately.',
        'gbp-missing': 'For restaurants, the Google Business Profile is often the first and only touchpoint. Photos, current hours, and your menu link belong there.',
        'gbp-stale': 'Restaurants live on Google. Fresh photos, current hours, and a current menu link keep you competitive.',
      },
    },
    'Home services (plumbing, HVAC, electrical, etc.)': {
      description: 'a home services business',
      pluralNoun: 'home services businesses',
      intent: 'homeowners with an urgent problem who need someone they can trust to call right now',
      ctaExamples: '"Get a free estimate", "Schedule service", or a prominent phone number',
      trustExamples: 'license numbers, photos of your real trucks and technicians, service area, and named reviews',
      benchmarks: {
        avgConversion: '3.0% to 5.0%',
        topQuartile: '10.0% to 12.0% or higher',
        mobileShare: '65% to 75%',
        sessionDuration: '2 minutes 24 seconds',
        dropOff: 'Service-area coverage pages and long quote estimate forms',
        tactics: 'Place clear tap-to-call buttons above the fold and shorten quote inquiry forms.',
      },
      perRec: {
        'cta-missing': 'For home services, "Get a free estimate", "Schedule service", or a prominent phone number convert best when a homeowner has an urgent problem.',
        'tap-call': 'A homeowner with a leak wants to tap your number once and talk. Anything more than that loses the call to the next contractor.',
        'trust-thin': 'License numbers, photos of your real team and trucks, and reviews mentioning specific jobs build trust fast in home services.',
        'gbp-missing': 'Home services live and die by local search. A complete Business Profile with photos, service area, and hours is the baseline.',
        'mobile-tap': 'Most home services inquiries start on a phone. A non tappable number or a hard to fill mobile form loses leads to the next contractor.',
        'gbp-stale': 'A stale Business Profile in home services usually means a competitor with a fresher one is taking your calls.',
      },
    },
    'Trades and contracting': {
      description: 'a trades or contracting business',
      pluralNoun: 'trades businesses',
      intent: 'homeowners and businesses sizing up whether you can do the job right',
      ctaExamples: '"Get a free quote", "Request a consult", or a prominent phone number',
      trustExamples: 'before and after photos of real projects, license and insurance info, and named project reviews',
      benchmarks: {
        avgConversion: '3.0% to 5.0%',
        topQuartile: '12.0% or higher',
        mobileShare: '65% to 70%',
        sessionDuration: '2 minutes 24 seconds',
        dropOff: 'Pricing breakdowns and booking calendar screens',
        tactics: 'Display license credentials prominently and integrate a real-time scheduler.',
      },
      perRec: {
        'cta-missing': 'For a contractor, "Get a free quote" or "Request a consult" convert better than generic buttons.',
        'trust-thin': 'Before and after photos of real projects, plus license and insurance info, carry more weight than star ratings alone in this industry.',
        'stale-content': 'A project portfolio that hasn\'t been updated in a year quietly tells visitors you may not be active.',
        'gbp-missing': 'Local search is how most trade jobs get found. A current Business Profile with project photos is the baseline.',
      },
    },
    'Professional services (legal, accounting, consulting)': {
      description: 'a professional services firm',
      pluralNoun: 'professional services firms',
      intent: 'prospects doing research to decide whether you\'re the right firm before they ever call',
      ctaExamples: '"Schedule a consultation", "Get a free intake call", or a contact form',
      trustExamples: 'credentials, case studies or client outcomes, and named testimonials',
      benchmarks: {
        avgConversion: '3.5% to 5.0%',
        topQuartile: '9.3% to 10.0% or higher',
        mobileShare: '35% to 45%',
        sessionDuration: '3 minutes 45 seconds',
        dropOff: 'Long-form case studies and contact pages with complex forms',
        tactics: 'Break up large blocks of text with visuals, and simplify intake forms to name and email only.',
      },
      perRec: {
        'cta-missing': 'For professional services, "Schedule a consultation" or "Get a free intake call" tend to convert better than a generic contact form.',
        'trust-thin': 'Credentials, case studies or client outcomes, and named testimonials are what professional services prospects look for.',
        'clarity-weak': 'For professional services, the homepage has to answer "do they handle my specific situation" within the first few seconds.',
        'stale-content': 'For a professional firm, recent insights or articles signal you\'re paying attention to your field.',
      },
    },
    'Health and wellness': {
      description: 'a health and wellness practice',
      pluralNoun: 'health and wellness practices',
      intent: 'people researching providers and deciding whether you\'re a fit before booking',
      ctaExamples: '"Book an appointment", "Schedule a free consultation", or "New patients welcome"',
      trustExamples: 'practitioner credentials, real photos of your space and team, and patient reviews',
      benchmarks: {
        avgConversion: '2.5% to 4.0%',
        topQuartile: '8.0% or higher',
        mobileShare: '65%',
        sessionDuration: '2 minutes 46 seconds',
        dropOff: 'Patient intake portals and insurance verification steps',
        tactics: 'Use HIPAA-compliant secure booking links and clarify accepted insurance up front.',
      },
      perRec: {
        'cta-missing': 'For a health and wellness practice, "Book an appointment" or "New patients welcome" convert better than generic forms.',
        'trust-thin': 'Credentials, real photos of your space and team, and patient reviews are what new patients look for first.',
        'mobile-tap': 'A lot of new patient research happens on a phone. Tap to call and tap to book are essential.',
      },
    },
    'Retail or e-commerce': {
      description: 'a retail or e-commerce business',
      pluralNoun: 'retail and e-commerce businesses',
      intent: 'shoppers comparing options and ready to buy when the experience feels right',
      ctaExamples: '"Shop now", "Add to cart", or "See the collection"',
      trustExamples: 'real product photography, customer reviews with photos, and clear shipping and return info',
      benchmarks: {
        avgConversion: '1.8% to 3.0%',
        topQuartile: '4.7% to 5.6% or higher',
        mobileShare: '65% to 75%',
        sessionDuration: '2 minutes 23 seconds',
        dropOff: 'Cart summary, shipping details, and the payment gateway. Median e-commerce checkout abandonment is 70.19%.',
        tactics: 'Implement guest checkout, offer address auto-complete, and display secure payment badges.',
      },
      perRec: {
        'load-slow': 'For retail, every extra second of load time directly maps to abandoned carts. Image weight is usually the culprit.',
        'cta-missing': 'For retail, "Shop now", "Add to cart", or "See the collection" beat generic buttons.',
        'trust-thin': 'Real product photography, customer reviews with photos, and clear shipping and return info are the credibility signals shoppers look for.',
        'mobile-tap': 'Mobile shopping is the majority of retail traffic. Filters, product details, and checkout all need to work fluidly on a phone.',
      },
    },
    'Real estate': {
      description: 'a real estate business',
      pluralNoun: 'real estate businesses',
      intent: 'buyers and sellers researching the local market and sizing up agents',
      ctaExamples: '"Get a home valuation", "Schedule a tour", or "Talk to an agent"',
      trustExamples: 'recent sold listings, neighborhood expertise content, and named client reviews',
      benchmarks: {
        avgConversion: '1.6% to 3.5%',
        topQuartile: '4.5% to 7.0% or higher',
        mobileShare: '75%',
        sessionDuration: '3 minutes 52 seconds',
        dropOff: 'Forced-registration popups and map search load states',
        tactics: 'Allow users to browse listings before requiring registration, and optimize mobile map speed.',
      },
      perRec: {
        'cta-missing': 'For real estate, "Get a home valuation", "Schedule a tour", or "Talk to an agent" tend to convert better than a generic contact form.',
        'trust-thin': 'Recent sold listings, neighborhood content, and named client reviews are the trust signals buyers and sellers look for.',
        'stale-content': 'A real estate site without recent listings or market updates signals you may not be active in the market.',
      },
    },
    'Salon, spa, or personal care': {
      description: 'a salon, spa, or personal care business',
      pluralNoun: 'salons and spas',
      intent: 'clients deciding whether your work and vibe match what they want',
      ctaExamples: '"Book online", "See our services", or "View pricing"',
      trustExamples: 'real photos of finished work, your space, and named client reviews',
      benchmarks: {
        avgConversion: '3.9%',
        topQuartile: '6.8% or higher',
        mobileShare: '80%',
        sessionDuration: '2 minutes 40 seconds',
        dropOff: 'Booking engine calendar interfaces and payment screens',
        tactics: 'Integrate booking software directly onto the site to prevent third-party redirections.',
      },
      perRec: {
        'cta-missing': 'For salons and spas, "Book online" or "See our services" convert better than generic buttons.',
        'trust-thin': 'Real photos of finished work, your space, and named client reviews are what new clients look for before booking.',
        'mobile-tap': 'Salon and spa booking decisions usually happen on a phone. Tap to book and tap to call have to work cleanly.',
      },
    },
    'Nonprofit': {
      description: 'a nonprofit',
      pluralNoun: 'nonprofits',
      intent: 'donors, volunteers, and beneficiaries deciding whether to engage with your mission',
      ctaExamples: '"Donate", "Volunteer", or "Get involved"',
      trustExamples: 'mission impact stories, named board members, financial transparency, and recent program photos',
      benchmarks: {
        avgConversion: '2.0%',
        topQuartile: '5.0% or higher',
        mobileShare: '60%',
        sessionDuration: '2 minutes 3 seconds',
        dropOff: 'Redirects to external donation platforms and complex forms',
        tactics: 'Embed security seals and process donations directly on the site to keep users on the domain.',
      },
      perRec: {
        'cta-missing': 'For a nonprofit, "Donate", "Volunteer", or "Get involved" need to be visible the moment someone lands.',
        'trust-thin': 'Mission impact stories, named board members, and financial transparency build the trust donors look for.',
        'stale-content': 'A nonprofit site without recent program updates signals to donors that their dollars may not be in motion.',
      },
    },
    'Something else': {
      description: 'a small business',
      pluralNoun: 'small businesses',
      intent: 'customers deciding whether to take the next step with you',
      ctaExamples: '"Get in touch", "Schedule a call", or your specific next step',
      trustExamples: 'real photos, named reviews, and clear contact info',
      perRec: {},
    },
  };

  const GOAL_CONTEXT = {
    leads: 'Your primary goal is generating leads, so the highest leverage thing your site can do is turn passive traffic into someone who reaches out.',
    sales: 'Your primary goal is driving sales, so the highest leverage thing your site can do is move visitors smoothly from interest to checkout.',
    trust: 'Your primary goal is building trust, so the highest leverage thing your site can do is signal credibility in the first few seconds.',
    info: 'Your primary goal is sharing info, so the highest leverage thing your site can do is make hours, location, and what you offer crystal clear.',
  };

  function getIndustry(industryName) {
    return INDUSTRIES[industryName] || INDUSTRIES['Something else'];
  }

  /* -------------------- RECOMMENDATIONS LIBRARY -------------------- */
  // Each rec: { id, condition(a), priority (critical|high|quick), category, title, why, how, impact }
  const RECS = [
    {
      id: 'ssl-warning',
      condition: (a) => a.ssl === 'warning',
      priority: 'critical', category: 'trust',
      title: 'Fix the "Not Secure" warning at the top of your site',
      why: 'A missing SSL connection triggers browser warning pages that immediately drive away up to 60% of potential visitors. Unsecure HTTP sites also face organic search ranking penalties.',
      how: 'Install a free SSL certificate through your hosting provider (Let\'s Encrypt is the standard). Then set up 301 redirects so all HTTP traffic routes to HTTPS.',
      impact: 'Up to 60% traffic recovery and a 2% to 30% conversion lift, depending on placement of security indicators near conversion points.',
      diyTime: '30 to 45 minutes',
    },
    {
      id: 'cta-missing',
      condition: (a) => a.ctaVisible === 'none' || a.ctaVisible === 'generic',
      priority: 'critical', category: 'clarity',
      title: 'Add a clear, specific call to action above the fold',
      why: 'Generic terms like "Submit" or "Click here" perform poorly. A specific CTA above the fold captures users who would otherwise bounce.',
      how: 'Place a high-contrast button at the top with action words like "Get a Quote" or "Book Now". Restricting the page to one focused CTA tends to outperform multiple competing offers.',
      impact: '10% to 15% conversion lift from above-the-fold placement, and up to 266% lift on single-focus pages that remove competing CTAs.',
      diyTime: '30 to 60 minutes',
    },
    {
      id: 'load-slow',
      condition: (a) => a.loadTime === 'slow' || a.loadTime === 'painful',
      priority: 'critical', category: 'performance',
      title: 'Compress images and speed up your homepage',
      why: '53% of mobile users abandon pages that take over three seconds. Uncompressed images are the most common cause, with 39% of users losing interest when they wait.',
      how: 'Compress all images and convert them to WebP. Enable lazy loading. Use Google PageSpeed Insights to find the biggest culprits. Pages loading in 1 to 2 seconds convert 3x better than pages over 5 seconds.',
      impact: 'Up to a 7% conversion lift per second saved, and recovers the up to 53% of mobile visitors who abandon slow pages.',
      diyTime: '30 to 90 minutes',
    },
    {
      id: 'clarity-weak',
      condition: (a) => a.clarityFiveSec === 'no' || a.clarityFiveSec === 'unsure',
      priority: 'critical', category: 'clarity',
      title: 'Rewrite your homepage so it passes the five second test',
      why: 'Awareness-stage drop-offs happen when a landing page fails the five-second test. If a user can\'t immediately understand what you do, who you serve, and what step to take next, they return to search results.',
      how: 'Make your value proposition the biggest text on the page. State what you do and who it serves in plain language. Make the next step obvious.',
      impact: 'Stops the awareness-stage drop-off that bounces visitors before they ever engage with the rest of the site.',
      diyTime: '60 to 90 minutes',
    },
    {
      id: 'mobile-tap',
      condition: (a) => a.mobileTaps === 'zoom' || a.mobileTaps === 'bad',
      priority: 'high', category: 'mobile',
      title: 'Make your site usable on a phone without pinching or zooming',
      why: 'Mobile drives roughly 65% of all traffic, yet converts at a median of just 1.82% compared to desktop\'s 3.14%. That 42% gap is usually transaction friction, including small tap targets and unreadable text.',
      how: 'Set tap targets to at least 44 by 44 pixels. Set body text to 16 pixels minimum. Make sure the viewport meta tag is in place.',
      impact: 'Closes the median 42% mobile to desktop conversion gap by removing friction on the platform that drives the majority of traffic.',
      diyTime: '45 to 90 minutes',
    },
    {
      id: 'gbp-missing',
      condition: (a) => a.gbp === 'never' || a.gbp === 'unsure',
      priority: 'high', category: 'seo',
      title: 'Claim and complete your Google Business Profile',
      why: 'Complete Business Profiles rank in the 3-result Local Pack 63% more often than incomplete listings, and the top 3 map results capture 42% to 54% of clicks on local searches.',
      how: 'Claim your business through Google, verify it, then add hours, photos, services, and your website link. Build a steady review pipeline (profiles with 50+ reviews get 4.4x more clicks).',
      impact: '63% higher Local Pack visibility, and up to 4.4x more clicks once you cross 50 positive reviews.',
      diyTime: '30 to 60 minutes',
    },
    {
      id: 'search-buried',
      condition: (a) => a.searchRank === 'buried' || a.searchRank === 'nowhere',
      priority: 'high', category: 'seo',
      title: 'Make your business findable by its own name',
      why: 'If a search for your exact business name and city can\'t surface your site, technical SEO is the most likely blocker. Technical infrastructure is the highest weighted SEO factor because indexing problems make everything else invisible.',
      how: 'Submit your sitemap to Google Search Console. Make sure your business name and city appear in the homepage title tag and main heading. Add LocalBusiness JSON-LD schema in the site header.',
      impact: 'Removes the indexing barriers that keep your site out of search results for your own business name.',
      diyTime: '45 to 90 minutes',
    },
    {
      id: 'stale-content',
      condition: (a) => a.lastUpdate === 'aWhile' || a.lastUpdate === 'never',
      priority: 'high', category: 'seo',
      title: 'Refresh your site with current content',
      why: 'Content freshness is a direct factor in the score search engines use to rank a site. Stale content signals to both visitors and search engines that the business may not be active.',
      how: 'Update your copyright year. Add a recent project, blog post, or testimonial. Refresh photos. Verify your hours and services are current.',
      impact: 'Restores the freshness signal that search engines use to rank actively maintained sites.',
      diyTime: '60 to 90 minutes',
    },
    {
      id: 'tap-call',
      condition: (a) => a.mobileTapCall === 'no' || a.mobileTapCall === 'none',
      priority: 'quick', category: 'mobile',
      title: 'Make your phone number tap to call on mobile',
      why: 'Standard mobile local pages with tap-to-call elements convert 47% better than pages without them. In mobile-first industries like home services, legal, and healthcare, adding one extra tap to the phone call pathway reduces calls 8% to 22%.',
      how: 'Wrap your phone number in a <a href="tel:..."> link in the HTML, or use your website builder\'s phone number widget. Test it on your own phone.',
      impact: '47% mobile conversion boost and prevents the 8% to 22% call loss that comes from any extra tap on the path to dialing.',
      diyTime: '15 minutes',
    },
    {
      id: 'trust-thin',
      condition: (a) => (a.trustSignals || []).length < 3,
      priority: 'high', category: 'trust',
      title: 'Add visible trust signals to your homepage',
      why: 'Verified GBP listings are 2.7x more likely to be perceived as reputable. Visible review counts, real photos, and clear contact information do the same heavy lifting on a homepage.',
      how: 'Add real customer reviews with names. Replace stock photos with photos of your real team or work. Display your phone number at the top of the page. Add a verified review badge if you have one.',
      impact: 'Adds the credibility cues visitors look for, and contributes to the 2% to 30% conversion lift seen when trust signals are placed near conversion points.',
      diyTime: '45 to 90 minutes',
    },
    {
      id: 'layout-shift',
      condition: (a) => a.layoutShift === 'lots',
      priority: 'high', category: 'performance',
      title: 'Stop the layout from jumping while pages load',
      why: 'Cumulative Layout Shift causes accidental misclicks and layout frustration. The ideal stability target is a near zero shift score during page load.',
      how: 'Set width and height on all images. Reserve space for ads or embeds. Load custom fonts so they swap into place without pushing text around.',
      impact: 'Prevents the misclicks and rage taps that drive visitors away mid-interaction.',
      diyTime: '45 to 90 minutes',
    },
    {
      id: 'sluggish',
      condition: (a) => a.responsiveness === 'frozen' || a.responsiveness === 'laggy',
      priority: 'high', category: 'performance',
      title: 'Cut the scripts slowing down user interactions',
      why: 'Interaction to Next Paint measures how quickly your site responds to taps and clicks. Sluggish interactions make visitors assume the site is broken.',
      how: 'Audit installed scripts and remove anything you don\'t actively use. Defer non critical scripts so they load after the main content is interactive.',
      impact: 'Restores the immediate response visitors expect when they tap or click.',
      diyTime: '60 to 90 minutes',
    },
    {
      id: 'cta-below',
      condition: (a) => a.ctaVisible === 'below',
      priority: 'quick', category: 'clarity',
      title: 'Move your main call to action higher on the page',
      why: 'A primary CTA above the fold can improve conversion rates by 10% to 15% by capturing users who would otherwise bounce. Visitors who don\'t see the next step rarely scroll to find one.',
      how: 'Place your primary button in the top section, right under the headline. Test it on a phone with no scrolling required.',
      impact: '10% to 15% conversion lift just from moving the CTA above the fold.',
      diyTime: '30 minutes',
    },
    {
      id: 'clarity-partly',
      condition: (a) => a.clarityFiveSec === 'partly',
      priority: 'quick', category: 'clarity',
      title: 'Tighten your homepage headline',
      why: 'A "sort of" answer to the five second test means visitors mostly get it, but cognitive alignment in the first moments drives whether they stay. Sharper copy closes that gap.',
      how: 'Cut filler words. Lead with the customer benefit, not your company name. One sentence, big text, plain language.',
      impact: 'Tightens the awareness-stage message to push borderline visitors into engaged ones.',
      diyTime: '30 to 60 minutes',
    },
    {
      id: 'gbp-stale',
      condition: (a) => a.gbp === 'stale',
      priority: 'quick', category: 'seo',
      title: 'Refresh your Google Business Profile',
      why: 'Local search rewards active profiles. GBPs that cross 100 reviews see an average 31% year-over-year increase in lead generation, and stale profiles lose Local Pack position to maintained ones.',
      how: 'Post a regular update, add new photos, verify your hours and services. Reply to recent reviews. Aim for steady weekly review additions.',
      impact: 'Restores Local Pack position and contributes to the 31% year-over-year lead lift seen on profiles that cross 100 reviews.',
      diyTime: '30 to 60 minutes',
    },
  ];

  function generateRecommendations(a) {
    const matched = RECS.filter((r) => r.condition(a));

    // Priority order
    const order = { critical: 0, high: 1, quick: 2 };
    matched.sort((a, b) => order[a.priority] - order[b.priority]);

    // Boost recs that align with chosen priorities
    const userPrios = a.priorities || [];
    const prioToCat = {
      leads: 'clarity', speed: 'performance', search: 'seo',
      mobile: 'mobile', design: 'clarity', trust: 'trust',
    };
    const boostedCats = new Set(userPrios.map((p) => prioToCat[p]));
    matched.sort((x, y) => {
      const xBoost = boostedCats.has(x.category) ? -0.5 : 0;
      const yBoost = boostedCats.has(y.category) ? -0.5 : 0;
      return (order[x.priority] + xBoost) - (order[y.priority] + yBoost);
    });

    // Attach industry-specific note where available
    const industry = getIndustry(a.industry);
    const enriched = matched.map((r) => ({
      ...r,
      industryNote: industry.perRec[r.id] || null,
    }));

    // Cap at 7 (Zeigarnik effect: 5 to 7 high impact tasks)
    return enriched.slice(0, 7);
  }

  /* -------------------- RESULTS RENDER -------------------- */
  function renderResults() {
    const a = collectAnswers();
    answers = a;

    const cats = scoreCategories(a);
    const score = compositeScore(cats);

    renderIndustryIntro(a);
    renderScore(score);
    renderCategoryBars(cats);
    renderLossCallout(score, a);
    recommendations = generateRecommendations(a);
    renderRecommendations();
    renderAnswerSummary(a);
    renderBadges();

    // Reveal results
    const resultsSection = $('#results');
    resultsSection.hidden = false;
    setTimeout(() => {
      resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }

  function renderIndustryIntro(a) {
    const wrap = $('#industryIntro');
    if (!wrap) return;
    const businessName = a.businessName || 'Your business';
    const industry = getIndustry(a.industry);
    const goalCopy = GOAL_CONTEXT[a.primaryGoal] || '';
    const url = (a.websiteUrl || '').replace(/^https?:\/\//i, '').replace(/\/$/, '');
    const b = industry.benchmarks;

    const benchmarkBlock = b ? `
        <div class="industry-benchmarks">
          <div class="industry-benchmarks-header">
            <span class="diamond"></span>
            <span>BENCHMARKS FOR ${industry.pluralNoun.toUpperCase()}</span>
          </div>
          <div class="benchmark-grid">
            <div class="benchmark-stat">
              <div class="benchmark-value">${b.avgConversion}</div>
              <div class="benchmark-label">Average conversion rate</div>
            </div>
            <div class="benchmark-stat">
              <div class="benchmark-value">${b.topQuartile}</div>
              <div class="benchmark-label">Top quartile sites</div>
            </div>
            <div class="benchmark-stat">
              <div class="benchmark-value">${b.mobileShare}</div>
              <div class="benchmark-label">Mobile share of traffic</div>
            </div>
            <div class="benchmark-stat">
              <div class="benchmark-value">${b.sessionDuration}</div>
              <div class="benchmark-label">Average session duration</div>
            </div>
          </div>
          <div class="benchmark-details">
            <div class="benchmark-row">
              <span class="benchmark-row-label">Where ${industry.pluralNoun} typically lose visitors</span>
              <span class="benchmark-row-value">${b.dropOff}</span>
            </div>
            <div class="benchmark-row">
              <span class="benchmark-row-label">What tends to fix it</span>
              <span class="benchmark-row-value">${b.tactics}</span>
            </div>
          </div>
        </div>` : '';

    wrap.innerHTML = `
      <div class="industry-intro-card">
        <div class="industry-intro-tag">PERSONALIZED FOR ${businessName.toUpperCase()}</div>
        <h3 class="industry-intro-title">${businessName} is ${industry.description}.</h3>
        <p class="industry-intro-body">
          The visitors landing on ${url ? `<strong>${url}</strong>` : 'your site'} are typically ${industry.intent}.
          ${goalCopy}
        </p>
        <ul class="industry-intro-list">
          <li>
            <span class="intro-list-label">Calls to action that tend to convert</span>
            <span class="intro-list-value">${industry.ctaExamples}</span>
          </li>
          <li>
            <span class="intro-list-label">Trust signals visitors look for</span>
            <span class="intro-list-value">${industry.trustExamples}</span>
          </li>
        </ul>
        ${benchmarkBlock}
      </div>
    `;
  }

  /* -------------------- ANSWER SUMMARY -------------------- */
  const ANSWER_LABELS = {
    clarityFiveSec: {
      label: 'Five second test',
      area: 'Brand clarity',
      values: {
        yes: { picked: 'Yes, all three.', read: 'Your homepage passes the cognitive alignment test, which is the single biggest predictor of whether visitors stay.' },
        partly: { picked: 'Sort of.', read: 'Visitors mostly get it, but a tighter headline could push that "sort of" into a confident yes.' },
        no: { picked: 'Honestly, no.', read: 'Vague or aspirational copy at the top is the most common cause of bounce on small business sites.' },
        unsure: { picked: 'Not sure.', read: 'A fresh five second test on a stranger\'s phone usually reveals the gaps your own eyes miss.' },
      },
    },
    ctaVisible: {
      label: 'Call to action above the fold',
      area: 'Conversion focus',
      values: {
        yes: { picked: 'Yes, it\'s right there.', read: 'A clear next step on the first screen is what turns passive traffic into leads.' },
        below: { picked: 'You have to scroll.', read: 'Visitors who don\'t see a next step in the first screen rarely scroll to find one.' },
        generic: { picked: '"Submit" or "Click here".', read: 'Generic calls to action perform poorly compared with specific ones like "Get a Quote" or "Book Now".' },
        none: { picked: 'There isn\'t one.', read: 'Without a visible next step, passive traffic stays passive. This is one of the fastest fixes you can make.' },
      },
    },
    mobileTaps: {
      label: 'Tap targets on mobile',
      area: 'Mobile usability',
      values: {
        yes: { picked: 'Easy to tap.', read: 'Your mobile tap targets are doing their job for the over ninety percent of traffic on phones.' },
        sometimes: { picked: 'Sometimes I miss.', read: 'Near miss taps add up. Tightening tap target sizing is a low effort fix.' },
        zoom: { picked: 'I have to pinch and zoom.', read: 'Pinch to zoom is a major friction point for the mobile traffic that makes up over ninety percent of visitors.' },
        bad: { picked: 'Basically unusable.', read: 'A site that\'s hard to use on a phone is invisible to the majority of your audience.' },
      },
    },
    mobileTapCall: {
      label: 'Tap to call',
      area: 'Mobile usability',
      values: {
        yes: { picked: 'Yes, it dials.', read: 'A tappable phone number removes friction for mobile visitors ready to talk.' },
        no: { picked: 'No, just text.', read: 'On mobile, a phone number that doesn\'t dial is a missed call waiting to happen.' },
        none: { picked: 'No number on site.', read: 'A phone number prominently placed is one of the most basic trust signals visitors look for.' },
      },
    },
    loadTime: {
      label: 'Page load time',
      area: 'Performance',
      values: {
        fast: { picked: 'Under 2 seconds.', read: 'You\'re under the threshold where mobile users start abandoning. Maintain this.' },
        ok: { picked: '2 to 4 seconds.', read: 'You\'re right at the edge. Over half of mobile users abandon pages that take over three seconds.' },
        slow: { picked: '4 to 8 seconds.', read: 'You\'re past the mobile abandonment threshold. Each extra second compounds.' },
        painful: { picked: 'Over 8 seconds.', read: 'Load time at this level is actively driving visitors away before they ever see your content.' },
      },
    },
    responsiveness: {
      label: 'Interaction response',
      area: 'Responsiveness',
      values: {
        instant: { picked: 'Instant.', read: 'Snappy interactions match what visitors expect. Search engines reward this too.' },
        laggy: { picked: 'A small lag.', read: 'Interaction lag erodes trust quickly. Usually it\'s a script that doesn\'t need to be there.' },
        frozen: { picked: 'Sluggish or frozen.', read: 'When the site feels broken, visitors assume it is. This is a high impact fix.' },
      },
    },
    layoutShift: {
      label: 'Layout stability',
      area: 'Visual stability',
      values: {
        never: { picked: 'Loads in place.', read: 'A stable layout prevents the misclicks and frustration that cause early bounces.' },
        sometimes: { picked: 'A little on slower connections.', read: 'Some shift is tolerable. The fix is usually setting image dimensions explicitly.' },
        lots: { picked: 'Things shift constantly.', read: 'Layout shift causes the misclicks and rage taps research identifies as a top frustration.' },
      },
    },
    ssl: {
      label: 'SSL / security',
      area: 'Security',
      values: {
        secure: { picked: 'Padlock is there.', read: 'You have the baseline trust signal customers and search engines both require.' },
        warning: { picked: '"Not secure" warning.', read: 'Unsecure HTTP sites scare away visitors and face organic search ranking penalties. Fix this first.' },
        unsure: { picked: 'Not sure.', read: 'Check now. SSL is the foundation of every other trust signal on your site.' },
      },
    },
    searchRank: {
      label: 'Branded search visibility',
      area: 'SEO',
      values: {
        first: { picked: 'Top result.', read: 'Your branded search is healthy. Now you can pursue category and local searches.' },
        firstPage: { picked: 'First page.', read: 'You\'re indexed correctly. The next move is moving up the page through content and links.' },
        buried: { picked: 'Page two or worse.', read: 'Page two on your own business name signals a technical SEO blocker worth investigating.' },
        nowhere: { picked: 'Can\'t find it.', read: 'If you\'re invisible on your own business name, search engines likely aren\'t indexing your pages.' },
      },
    },
    gbp: {
      label: 'Google Business Profile',
      area: 'SEO',
      values: {
        active: { picked: 'Active and current.', read: 'A maintained Business Profile is one of the strongest local SEO assets you can have.' },
        stale: { picked: 'Stale.', read: 'A stale profile loses to a competitor with a fresher one. Refresh it monthly.' },
        never: { picked: 'Never set one up.', read: 'Without a Google Business Profile, you\'re invisible to most local intent searches.' },
        unsure: { picked: 'Not sure what that is.', read: 'It\'s the local listing that shows in Google Maps and the local pack. It\'s free and high impact.' },
      },
    },
    lastUpdate: {
      label: 'Last meaningful update',
      area: 'SEO',
      values: {
        recent: { picked: 'Within 3 months.', read: 'Fresh content signals to search engines and visitors that the business is active.' },
        thisYear: { picked: 'Sometime this year.', read: 'Reasonable cadence. A monthly refresh keeps you ahead of stale competitors.' },
        aWhile: { picked: 'Over a year ago.', read: 'A year without updates is when search engines start treating your site as low priority.' },
        never: { picked: 'Never since launch.', read: 'A site frozen at launch sends the same signal as a closed sign on the front door.' },
      },
    },
  };

  function renderAnswerSummary(a) {
    const wrap = $('#answerSummary');
    if (!wrap) return;
    const items = [];
    Object.keys(ANSWER_LABELS).forEach((key) => {
      const def = ANSWER_LABELS[key];
      const value = a[key];
      const map = def.values[value];
      if (!map) return;
      items.push({ label: def.label, area: def.area, picked: map.picked, read: map.read });
    });

    // Trust signals checked
    const sig = (a.trustSignals || []);
    if (sig.length > 0) {
      items.push({
        label: 'Trust signals on your homepage',
        area: 'Trust',
        picked: `${sig.length} of 6 selected.`,
        read: sig.length >= 4
          ? 'A solid base of trust cues. Layering in any remaining ones keeps you ahead of competitors.'
          : 'Adding two or three more would close the gap most small business sites have.',
      });
    } else if (a.ssl) {
      items.push({
        label: 'Trust signals on your homepage',
        area: 'Trust',
        picked: 'None selected.',
        read: 'Visitors form an opinion in fifty milliseconds. Trust signals are what do the work in that window.',
      });
    }

    wrap.innerHTML = `
      <div class="answer-summary-header">
        <h3>How you answered, and what it tells us</h3>
        <p>Each input drives the score and your action plan. Here's the read on each one.</p>
      </div>
      <div class="answer-summary-grid">
        ${items.map((it) => `
          <div class="answer-summary-item">
            <div class="answer-meta">
              <span class="answer-label">${it.label}</span>
              <span class="answer-area">${it.area}</span>
            </div>
            <div class="answer-picked">${it.picked}</div>
            <div class="answer-read">${it.read}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderScore(score) {
    // Animate count up
    const numEl = $('#scoreNumber');
    const ringEl = $('#scoreRing');
    const gradeEl = $('#scoreGrade');
    const takeawayEl = $('#scoreTakeaway');

    const duration = 1400;
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      numEl.textContent = Math.floor(eased * score);
      if (progress < 1) requestAnimationFrame(tick);
      else numEl.textContent = score;
    };
    requestAnimationFrame(tick);

    // Animate ring
    const circumference = 2 * Math.PI * 86;
    const offset = circumference - (score / 100) * circumference;
    setTimeout(() => {
      ringEl.style.strokeDasharray = circumference;
      ringEl.style.strokeDashoffset = offset;
    }, 80);

    // Grade + color + takeaway
    let grade, gradeClass, takeaway, ringColor;
    if (score >= 80) {
      grade = 'Strong shape';
      gradeClass = 'grade-good';
      ringColor = 'var(--green)';
      takeaway = 'Your site is doing the heavy lifting. A few quick wins will tighten the rest.';
    } else if (score >= 60) {
      grade = 'Some work to do';
      gradeClass = 'grade-ok';
      ringColor = 'var(--orange)';
      takeaway = 'You\'re leaving real money on the table. The fixes below are the highest leverage spots.';
    } else if (score >= 40) {
      grade = 'Needs attention';
      gradeClass = 'grade-ok';
      ringColor = 'var(--orange)';
      takeaway = 'There are urgent problems costing you customers right now. The good news is the highest impact ones are clearly defined below.';
    } else {
      grade = 'Critical issues';
      gradeClass = 'grade-poor';
      ringColor = 'var(--red)';
      takeaway = 'Your site is actively driving visitors away. Don\'t panic. Start with the critical fixes below.';
    }

    gradeEl.textContent = grade;
    gradeEl.className = 'score-grade ' + gradeClass;
    ringEl.style.stroke = ringColor;
    takeawayEl.textContent = takeaway;
  }

  function renderCategoryBars(cats) {
    const list = $('#categoryList');
    list.innerHTML = '';
    const labels = {
      clarity: 'Brand clarity',
      mobile: 'Mobile experience',
      performance: 'Speed & responsiveness',
      trust: 'Trust & security',
      seo: 'Search visibility',
    };
    const order = ['clarity', 'mobile', 'performance', 'trust', 'seo'];
    order.forEach((key, i) => {
      const value = cats[key];
      const tone = value >= 75 ? 'good' : value >= 50 ? 'ok' : 'poor';
      const li = document.createElement('li');
      li.className = 'category-item';
      li.innerHTML = `
        <div class="cat-row">
          <span class="cat-name">${labels[key]}</span>
          <span class="cat-score">${value} / 100</span>
        </div>
        <div class="cat-bar"><div class="cat-bar-fill ${tone}"></div></div>
      `;
      list.appendChild(li);
      // Animate width after insert
      setTimeout(() => {
        li.querySelector('.cat-bar-fill').style.width = value + '%';
      }, 200 + i * 120);
    });
  }

  function renderLossCallout(score, a) {
    const head = $('#lossHeadline');
    const body = $('#lossBody');
    const businessName = a.businessName || 'Your business';
    const industry = getIndustry(a.industry);
    const b = industry.benchmarks;
    const industryLine = b
      ? ` Average conversion rates for ${industry.pluralNoun} run ${b.avgConversion}, with top quartile sites at ${b.topQuartile}.`
      : '';

    if (score >= 80) {
      head.textContent = 'You\'re ahead of most';
      body.textContent = `${businessName} is doing the things research shows actually matter. The fixes below are about polish, not patches.${industryLine}`;
    } else if (score >= 60) {
      head.textContent = 'Here\'s where the leaks are';
      body.textContent = `${businessName} has clear opportunities. Mobile drives roughly 65% of all traffic but converts at a median of 1.82% compared to desktop\'s 3.14%. The fixes below are the ones that tend to close that 42% gap.${industryLine}`;
    } else {
      head.textContent = 'This is the part most owners don\'t realize';
      body.textContent = `${businessName} is showing the patterns that quietly cost small businesses customers. A missing SSL connection alone can turn away up to 60% of visitors, and a slow loading site costs up to 7% of conversions per second of delay. The plan below is built to stop the leak.${industryLine}`;
    }
  }

  /* -------------------- RENDER RECOMMENDATIONS -------------------- */
  function renderRecommendations() {
    const grid = $('#planGrid');
    grid.innerHTML = '';
    $('#totalCount').textContent = recommendations.length;
    $('#completedCount').textContent = '0';

    if (!recommendations.length) {
      grid.innerHTML = `
        <div class="plan-card" style="grid-column: 1 / -1;">
          <h3 class="plan-card-title">No critical issues found.</h3>
          <p>Honestly, your site is in great shape. Keep the maintenance habits going and check back in a quarter.</p>
        </div>
      `;
      updatePlanProgress();
      return;
    }

    recommendations.forEach((rec) => {
      const card = document.createElement('article');
      card.className = 'plan-card';
      card.dataset.priority = rec.priority;
      card.dataset.id = rec.id;
      const label = rec.priority === 'critical' ? 'Critical fix' :
                    rec.priority === 'high' ? 'High impact' : 'Quick win';
      const industryBlock = rec.industryNote ? `
          <div class="plan-detail plan-industry">
            <strong>For your industry</strong>
            <p>${rec.industryNote}</p>
          </div>` : '';
      const timePill = rec.diyTime ? `<span class="time-pill"><span class="time-icon" aria-hidden="true">&#9202;</span> ${rec.diyTime}</span>` : '';
      card.innerHTML = `
        <div class="plan-card-top">
          <div class="plan-card-tags">
            <span class="priority-badge ${rec.priority}">${label}</span>
            ${timePill}
          </div>
          <button type="button" class="plan-checkbox" aria-label="Mark as done"></button>
        </div>
        <h4 class="plan-card-title">${rec.title}</h4>
        <div class="plan-card-body">
          <div class="plan-detail">
            <strong>Why it matters</strong>
            <p>${rec.why}</p>
          </div>
          <div class="plan-detail">
            <strong>How to fix it</strong>
            <p>${rec.how}</p>
          </div>${industryBlock}
        </div>
        <div class="plan-impact">
          <span class="plan-impact-icon">&uarr;</span>
          <span><strong>Expected impact:</strong> ${rec.impact}</span>
        </div>
      `;
      grid.appendChild(card);

      card.querySelector('.plan-checkbox').addEventListener('click', () => {
        toggleComplete(rec.id, card);
      });
    });

    updatePlanProgress();
  }

  function toggleComplete(id, card) {
    if (completedIds.has(id)) {
      completedIds.delete(id);
      card.classList.remove('completed');
    } else {
      completedIds.add(id);
      card.classList.add('completed');
      celebrate(card);
    }
    updatePlanProgress();
    renderBadges();
  }

  function updatePlanProgress() {
    const total = recommendations.length;
    const done = completedIds.size;
    const pct = total ? Math.round((done / total) * 100) : 0;
    $('#completedCount').textContent = done;
    $('#planPercent').textContent = pct + '%';
    $('#planProgressFill').style.width = pct + '%';
  }

  /* -------------------- BADGES -------------------- */
  const BADGES = [
    { id: 'first-step', name: 'First Step', icon: '&#10004;', test: () => completedIds.size >= 1 },
    { id: 'momentum', name: 'Momentum', icon: '&#9889;', test: () => completedIds.size >= 3 },
    { id: 'half-way', name: 'Halfway Hero', icon: '&#127881;', test: () => recommendations.length && completedIds.size >= Math.ceil(recommendations.length / 2) },
    { id: 'critical-killer', name: 'Critical Crusher', icon: '&#128737;', test: () => {
      const criticals = recommendations.filter((r) => r.priority === 'critical');
      return criticals.length > 0 && criticals.every((r) => completedIds.has(r.id));
    } },
    { id: 'all-done', name: 'Site Audit Master', icon: '&#127942;', test: () => recommendations.length && completedIds.size === recommendations.length },
  ];

  function renderBadges() {
    const row = $('#badgesRow');
    row.innerHTML = '';
    BADGES.forEach((b) => {
      const earned = b.test();
      const div = document.createElement('div');
      div.className = 'badge' + (earned ? ' earned' : '');
      div.innerHTML = `
        <div class="badge-icon">${b.icon}</div>
        <div class="badge-name">${b.name}</div>
      `;
      row.appendChild(div);
      if (earned && !div.dataset.celebrated) {
        div.dataset.celebrated = 'true';
      }
    });
  }

  /* -------------------- CONFETTI -------------------- */
  function celebrate(originEl) {
    const root = $('#confettiRoot');
    if (!root) return;
    const colors = ['#C8102E', '#1A2547', '#22C55E', '#F97316', '#FBE6EA'];
    const rect = originEl.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;
    for (let i = 0; i < 28; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.background = colors[i % colors.length];
      piece.style.left = startX + (Math.random() - 0.5) * 240 + 'px';
      piece.style.top = rect.top + 'px';
      piece.style.animationDelay = (Math.random() * 0.2) + 's';
      piece.style.animationDuration = (1.6 + Math.random() * 1) + 's';
      piece.style.transform = `rotate(${Math.random() * 360}deg)`;
      root.appendChild(piece);
      setTimeout(() => piece.remove(), 2600);
    }
  }

  /* -------------------- FILTERS -------------------- */
  function applyFilter(filter) {
    activeFilter = filter;
    $$('.filter-pill').forEach((p) => {
      const isActive = p.dataset.filter === filter;
      p.classList.toggle('active', isActive);
      p.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    $$('.plan-card').forEach((card) => {
      const p = card.dataset.priority;
      const show = filter === 'all' || p === filter;
      card.classList.toggle('hidden', !show);
    });
  }

  /* -------------------- PRIORITY LIMIT (max 3) -------------------- */
  function limitPriorityChecks() {
    const checks = $$('input[name="priorities"]');
    checks.forEach((c) => {
      c.addEventListener('change', () => {
        const checkedCount = checks.filter((x) => x.checked).length;
        if (checkedCount > 3) {
          c.checked = false;
        }
      });
    });
  }

  /* -------------------- SLIDER LIVE VALUE -------------------- */
  function wireSlider() {
    const slider = $('#mobileFeel');
    const out = $('#mobileFeelValue');
    if (!slider || !out) return;
    slider.addEventListener('input', () => { out.textContent = slider.value; });
  }

  /* -------------------- LIVE FIELD CLEANUP -------------------- */
  function wireLiveClears() {
    $$('input, select').forEach((el) => {
      el.addEventListener('input', () => {
        el.classList.remove('invalid');
        const err = $(`.field-error[data-for="${el.name}"]`);
        if (err) err.classList.remove('show');
      });
      el.addEventListener('change', () => {
        el.classList.remove('invalid');
        const err = $(`.field-error[data-for="${el.name}"]`);
        if (err) err.classList.remove('show');
      });
    });
  }

  /* -------------------- WIZARD CONTROLS -------------------- */
  function wireWizard() {
    $('#nextBtn').addEventListener('click', () => {
      if (!validateStep(currentStep)) return;
      if (currentStep < TOTAL_STEPS) {
        currentStep++;
        showStep(currentStep, { scrollIntoView: true });
      }
    });
    $('#prevBtn').addEventListener('click', () => {
      if (currentStep > 1) {
        currentStep--;
        showStep(currentStep, { scrollIntoView: true });
      }
    });
    $('#finishBtn').addEventListener('click', () => {
      if (!validateStep(currentStep)) return;
      renderResults();
    });
  }

  /* -------------------- RESTART -------------------- */
  function wireRestart() {
    $('#restartBtn').addEventListener('click', () => {
      $('#auditForm').reset();
      completedIds = new Set();
      recommendations = [];
      currentStep = 1;
      $('#results').hidden = true;
      showStep(1);
      $('#mobileFeelValue').textContent = '5';
      $('#audit').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /* -------------------- BOOK CALL CTA -------------------- */
  function wireBookCall() {
    $('#bookCallBtn').addEventListener('click', (e) => {
      e.preventDefault();
      alert('In production, this opens the Penn Square Digital booking calendar. For the demo, your audit responses are already saved to your screen.');
    });
  }

  /* -------------------- FILTER PILLS -------------------- */
  function wireFilters() {
    $$('.filter-pill').forEach((pill) => {
      pill.addEventListener('click', () => applyFilter(pill.dataset.filter));
    });
  }

  /* -------------------- INIT -------------------- */
  function init() {
    animateCountersOnScroll();
    showStep(1);
    buildStepDots();
    wireWizard();
    wireSlider();
    wireLiveClears();
    limitPriorityChecks();
    wireRestart();
    wireBookCall();
    wireFilters();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
