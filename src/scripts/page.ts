type TocItem = {
  id: string;
  text: string;
  depth: number;
};

type GistComment = {
  id: number;
  body_html: string;
  body: string;
  created_at: string;
  updated_at: string;
  user: { avatar_url: string; html_url: string; login: string };
};

type DiscussionCache = {
  savedAt: number;
  comments: GistComment[];
};

const tocTargetSelector =
  "article[data-article-body] h2, article[data-article-body] h3, article[data-article-body] h4, [data-toc-target]";
const discussionCacheMaxAgeMs = 5 * 60 * 1000;
const discussionCacheFallbackMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
const mobileLayoutBreakpointPx = 900;
const pageShellMaxWidthPx = 1440;
const pageShellGutterPx = 40;
const collapsedContextShellWidthPx = 1396;
let scrollSpyObserver: IntersectionObserver | null = null;
let tocTitleObserver: IntersectionObserver | null = null;
let progressListenersBound = false;
let desktopContextDismissed = false;
let mobileContextDismissed = false;
let desktopContextTriggered = false;
let mobileContextTriggered = false;
const permalinkHeadingSelector = "article[data-article-body] h2, article[data-article-body] h3, article[data-article-body] h4, .discussion__header h2";

const createSlug = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");

const getHeadingText = (target: HTMLElement) => {
  if (target.dataset.tocText) {
    return target.dataset.tocText;
  }

  const clone = target.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".heading-permalink").forEach((node) => node.remove());
  return clone.textContent?.trim() || "";
};

const syncNavigation = () => {
  const items = getTocItems();
  const desktop = document.querySelector<HTMLElement>("[data-toc-desktop]");
  const mobile = document.querySelector<HTMLElement>("[data-toc-mobile]");

  if (!desktop || !mobile) return;

  renderToc(desktop, items);
  renderToc(mobile, items);
  setupAnchors();
  setupScrollSpy();
};

const copyText = async (value: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "true");
  input.style.position = "absolute";
  input.style.left = "-9999px";
  document.body.append(input);
  input.select();
  document.execCommand("copy");
  input.remove();
};

const setupPermalinkButtons = () => {
  const headings = Array.from(document.querySelectorAll<HTMLElement>(permalinkHeadingSelector));

  for (const heading of headings) {
    const headingText = getHeadingText(heading) || "section";

    if (!heading.id) {
      heading.id = createSlug(headingText);
    }

    if (heading.querySelector(".heading-permalink")) {
      continue;
    }

    heading.classList.add("has-permalink");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "heading-permalink";
    button.setAttribute("aria-label", `Copy permalink to ${headingText}`);
    button.title = "Copy permalink";

    const label = document.createElement("span");
    label.className = "sr-only";
    label.textContent = "Copy permalink";
    button.append(label);

    button.addEventListener("click", async () => {
      const url = new URL(window.location.href);
      url.hash = heading.id;

      try {
        await copyText(url.toString());
        button.classList.add("is-copied");
        button.title = "Copied";
        window.setTimeout(() => {
          button.classList.remove("is-copied");
          button.title = "Copy permalink";
        }, 1200);
      } catch {
        button.title = "Copy failed";
      }
    });

    heading.append(button);
  }
};

const getTocItems = (): TocItem[] => {
  const targets = Array.from(document.querySelectorAll<HTMLElement>(tocTargetSelector));
  return targets.map((target) => {
    const text = getHeadingText(target) || "section";

    if (!target.id) {
      target.id = createSlug(text);
    }

    return {
      id: target.id,
      text,
      depth: Number.parseInt(target.dataset.tocDepth || target.tagName.slice(1), 10)
    };
  });
};

const renderToc = (container: HTMLElement, items: TocItem[]) => {
  container.innerHTML = "";

  const list = document.createElement("ol");
  list.className = "toc-list__items";

  for (const item of items) {
    const entry = document.createElement("li");
    entry.className = `toc-list__item toc-list__item--depth-${item.depth}`;

    const link = document.createElement("a");
    link.className = "toc-list__link";
    link.href = `#${item.id}`;
    link.dataset.targetId = item.id;
    link.textContent = item.text;

    entry.append(link);
    list.append(entry);
  }

  container.append(list);
};

const setupAnchors = () => {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".toc-list__link"));
  for (const link of links) {
    link.addEventListener("click", (event) => {
      const targetId = link.dataset.targetId;
      if (!targetId) return;

      const heading = document.getElementById(targetId);
      if (!heading) return;

      event.preventDefault();
      heading.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState(null, "", `#${targetId}`);

      const mobileToc = document.querySelector<HTMLElement>("[data-mobile-toc]");
      if (mobileToc?.classList.contains("is-open")) {
        closeDrawer();
      }
    });
  }
};

const setActiveHeading = (id: string) => {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".toc-list__link"));
  for (const link of links) {
    const isActive = link.dataset.targetId === id;
    link.classList.toggle("is-active", isActive);
    link.setAttribute("aria-current", isActive ? "true" : "false");

    if (!isActive) continue;

    const scrollParent = link.closest<HTMLElement>("[data-toc-scroll], .toc-list--mobile");
    if (!scrollParent) continue;

    const linkTop = link.offsetTop;
    const linkBottom = linkTop + link.offsetHeight;
    const visibleTop = scrollParent.scrollTop;
    const visibleBottom = visibleTop + scrollParent.clientHeight;
    const padding = 28;

    if (linkTop >= visibleTop + padding && linkBottom <= visibleBottom - padding) {
      continue;
    }

    const targetTop = linkTop - scrollParent.clientHeight / 2 + link.offsetHeight / 2;
    scrollParent.scrollTo({
      top: Math.max(0, targetTop),
      behavior: "smooth"
    });
  }
};

const shouldUseMobileContextPrompt = () => {
  if (window.innerWidth <= mobileLayoutBreakpointPx) {
    return true;
  }

  const expandedShellWidth = Math.min(pageShellMaxWidthPx, window.innerWidth - pageShellGutterPx);
  return expandedShellWidth <= collapsedContextShellWidthPx;
};

const syncContextLayout = () => {
  const pageShell = document.querySelector<HTMLElement>("[data-page-shell]");
  const useMobilePrompt = shouldUseMobileContextPrompt();

  pageShell?.classList.toggle(
    "page-shell--collapsed-context",
    useMobilePrompt && window.innerWidth > mobileLayoutBreakpointPx
  );

  return useMobilePrompt;
};

const syncMobileContextPromptPosition = () => {
  const prompt = document.querySelector<HTMLElement>("[data-mobile-context-prompt]");
  const essayBody = document.querySelector<HTMLElement>(".essay-body");

  if (!prompt || !essayBody) return;

  const rect = essayBody.getBoundingClientRect();
  prompt.style.setProperty("--mobile-context-left", `${rect.left}px`);
  prompt.style.setProperty("--mobile-context-width", `${rect.width}px`);
};

const updateProgress = () => {
  const article = document.querySelector<HTMLElement>("[data-article-body]");
  const indicator = document.querySelector<HTMLElement>("[data-progress-indicator]");
  const useMobileContextPrompt = syncContextLayout();
  syncMobileContextPromptPosition();

  if (!article || !indicator) {
    updateMobileContextPrompt(null, useMobileContextPrompt);
    updateDesktopContextPrompt(null, useMobileContextPrompt);
    return;
  }

  const viewportHeight = window.innerHeight;
  const rect = article.getBoundingClientRect();
  const scrollTop = window.scrollY + rect.top;
  const articleHeight = article.offsetHeight;
  const scrollRange = Math.max(articleHeight - viewportHeight, 1);
  const progress = Math.min(Math.max((window.scrollY - scrollTop) / scrollRange, 0), 1);
  const visibleRatio = Math.min(viewportHeight / Math.max(articleHeight, viewportHeight), 1);
  const indicatorHeight = Math.min(Math.max(visibleRatio * 100, 14), 100);
  const offset = progress * (100 - indicatorHeight);

  indicator.style.height = `${indicatorHeight}%`;
  indicator.style.top = `${offset}%`;
  syncContextPromptTriggers(progress);
  updateDesktopContextPrompt(progress, useMobileContextPrompt);
  updateMobileContextPrompt(progress, useMobileContextPrompt);
};

const syncContextPromptTriggers = (progress: number) => {
  const triggerHeading = document.getElementById("a-note-before-you-read");
  const viewportHeight = window.innerHeight;
  const hasReachedTrigger = triggerHeading
    ? triggerHeading.getBoundingClientRect().top <= viewportHeight * 0.45
    : progress >= 0.08;

  if (hasReachedTrigger) {
    desktopContextTriggered = true;
    mobileContextTriggered = true;
  }
};

const updateDesktopContextPrompt = (progress: number | null, useMobilePrompt: boolean) => {
  const rail = document.querySelector<HTMLElement>(".context-rail");
  if (!rail) return;

  if (useMobilePrompt || desktopContextDismissed || progress === null) {
    rail.classList.remove("is-visible");
    rail.setAttribute("aria-hidden", "true");
    return;
  }

  const isVisible = desktopContextTriggered;
  rail.classList.toggle("is-visible", isVisible);
  rail.setAttribute("aria-hidden", isVisible ? "false" : "true");
};

const updateMobileContextPrompt = (progress: number | null, useMobilePrompt: boolean) => {
  const prompt = document.querySelector<HTMLElement>("[data-mobile-context-prompt]");
  if (!prompt) return;

  if (!useMobilePrompt || mobileContextDismissed || progress === null) {
    prompt.classList.remove("is-visible");
    prompt.setAttribute("aria-hidden", "true");
    return;
  }

  const isVisible = mobileContextTriggered;
  prompt.classList.toggle("is-visible", isVisible);
  prompt.setAttribute("aria-hidden", isVisible ? "false" : "true");
};

const setupMobileContextPrompt = () => {
  const dismissButton = document.querySelector<HTMLElement>("[data-mobile-context-dismiss]");
  if (!dismissButton) return;

  dismissButton.addEventListener("click", () => {
    mobileContextDismissed = true;
    updateMobileContextPrompt(null, syncContextLayout());
  });
};

const setupDesktopContextPrompt = () => {
  const dismissButton = document.querySelector<HTMLElement>("[data-context-dismiss]");
  if (!dismissButton) return;

  dismissButton.addEventListener("click", () => {
    desktopContextDismissed = true;
    updateDesktopContextPrompt(null, syncContextLayout());
  });
};

const setupScrollSpy = () => {
  scrollSpyObserver?.disconnect();

  const targets = Array.from(document.querySelectorAll<HTMLElement>(tocTargetSelector));
  if (!targets.length) return;

  let currentId = targets[0]?.id || "";
  setActiveHeading(currentId);

  scrollSpyObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

      if (!visible.length) return;

      currentId = (visible[0].target as HTMLElement).id;
      setActiveHeading(currentId);
    },
    {
      rootMargin: "-18% 0px -60% 0px",
      threshold: [0.1, 0.25, 0.5, 0.75, 1]
    }
  );

  targets.forEach((target) => scrollSpyObserver?.observe(target));
  updateProgress();
  if (!progressListenersBound) {
    window.addEventListener("scroll", updateProgress, { passive: true });
    window.addEventListener("resize", updateProgress);
    progressListenersBound = true;
  }
};

const openDrawer = () => {
  const trigger = document.querySelector<HTMLElement>("[data-toc-trigger]");
  const mobileToc = document.querySelector<HTMLElement>("[data-mobile-toc]");
  if (!trigger || !mobileToc) return;

  trigger.setAttribute("aria-expanded", "true");
  trigger.classList.add("is-hidden");
  mobileToc.classList.add("is-open");
  mobileToc.setAttribute("aria-hidden", "false");
  document.body.classList.add("drawer-open");
};

const closeDrawer = () => {
  const trigger = document.querySelector<HTMLElement>("[data-toc-trigger]");
  const mobileToc = document.querySelector<HTMLElement>("[data-mobile-toc]");
  if (!trigger || !mobileToc) return;

  trigger.setAttribute("aria-expanded", "false");
  trigger.classList.remove("is-hidden");
  mobileToc.classList.remove("is-open");
  mobileToc.setAttribute("aria-hidden", "true");
  document.body.classList.remove("drawer-open");
};

const setupDrawer = () => {
  document.querySelector<HTMLElement>("[data-toc-trigger]")?.addEventListener("click", openDrawer);
  document.querySelectorAll<HTMLElement>("[data-toc-close]").forEach((node) => {
    node.addEventListener("click", closeDrawer);
  });
};

const setupTocTitleVisibility = () => {
  tocTitleObserver?.disconnect();

  const heroTitle = document.querySelector<HTMLElement>("[data-hero-title]");
  const tocTitle = document.querySelector<HTMLElement>("[data-toc-rail-title]");
  if (!heroTitle || !tocTitle) return;

  tocTitle.classList.remove("is-visible");

  tocTitleObserver = new IntersectionObserver(
    ([entry]) => {
      tocTitle.classList.toggle("is-visible", !entry?.isIntersecting);
    },
    {
      rootMargin: "0px 0px -12% 0px",
      threshold: 0.1
    }
  );

  tocTitleObserver.observe(heroTitle);
};

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric"
  });

const renderComment = (comment: GistComment) => {
  const article = document.createElement("article");
  article.className = "comment-card";
  article.id = `reader-note-${comment.id}`;
  article.dataset.tocTarget = "";
  article.dataset.tocText = comment.user.login;
  article.dataset.tocDepth = "3";
  article.innerHTML = `
    <header class="comment-card__header">
      <img class="comment-card__avatar" src="${comment.user.avatar_url}" alt="" width="44" height="44" />
      <div>
        <a class="comment-card__author" href="${comment.user.html_url}" target="_blank" rel="noreferrer">${comment.user.login}</a>
        <p class="comment-card__date">${formatDate(comment.created_at)}</p>
      </div>
    </header>
    <div class="comment-card__body">${comment.body_html}</div>
  `;
  return article;
};

const getDiscussionCacheKey = (gistId: string) => `gist-comments:${gistId}`;

const loadDiscussionCache = (gistId: string): DiscussionCache | null => {
  try {
    const raw = window.localStorage.getItem(getDiscussionCacheKey(gistId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<DiscussionCache>;
    if (!parsed || typeof parsed.savedAt !== "number" || !Array.isArray(parsed.comments)) {
      return null;
    }

    return {
      savedAt: parsed.savedAt,
      comments: parsed.comments as GistComment[]
    };
  } catch {
    return null;
  }
};

const saveDiscussionCache = (gistId: string, comments: GistComment[]) => {
  try {
    const payload: DiscussionCache = {
      savedAt: Date.now(),
      comments
    };

    window.localStorage.setItem(getDiscussionCacheKey(gistId), JSON.stringify(payload));
  } catch {
    // Ignore storage failures and continue with network-backed rendering.
  }
};

const renderDiscussionComments = (list: HTMLElement, status: HTMLElement, comments: GistComment[]) => {
  list.innerHTML = "";

  if (!comments.length) {
    list.hidden = true;
    status.hidden = false;
    return;
  }

  comments.forEach((comment) => list.append(renderComment(comment)));
  list.hidden = false;
  status.hidden = true;
};

const setupDiscussion = async () => {
  const root = document.querySelector<HTMLElement>("[data-discussion]");
  const status = document.querySelector<HTMLElement>("[data-discussion-status]");
  const list = document.querySelector<HTMLElement>("[data-discussion-list]");
  if (!root || !status || !list) return;

  const gistId = root.dataset.gistId;
  const gistUrl = root.dataset.gistUrl || "#";

  if (!gistId) {
    return;
  }

  const cached = loadDiscussionCache(gistId);
  const cacheAge = cached ? Date.now() - cached.savedAt : Number.POSITIVE_INFINITY;

  if (cached) {
    renderDiscussionComments(list, status, cached.comments);
    syncNavigation();

    if (!cached.comments.length) {
      status.innerHTML = `No comments yet. Post on <a href="${gistUrl}" target="_blank" rel="noreferrer">GitHub</a> and new replies will appear here.`;
    }

    if (cacheAge < discussionCacheMaxAgeMs) {
      return;
    }

    status.hidden = false;
    status.textContent = "Refreshing comments…";
  } else {
    status.textContent = "Loading comments from GitHub…";
  }

  try {
    const response = await fetch(`https://api.github.com/gists/${gistId}/comments`, {
      headers: {
        Accept: "application/vnd.github.full+json"
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}`);
    }

    const comments = (await response.json()) as GistComment[];
    saveDiscussionCache(gistId, comments);

    if (!comments.length) {
      status.innerHTML = `No comments yet. Post on <a href="${gistUrl}" target="_blank" rel="noreferrer">GitHub</a> and new replies will appear here.`;
      list.innerHTML = "";
      list.hidden = true;
      status.hidden = false;
      syncNavigation();
      return;
    }

    renderDiscussionComments(list, status, comments);
    syncNavigation();
  } catch (_error) {
    if (cached && cacheAge < discussionCacheFallbackMaxAgeMs) {
      if (!cached.comments.length) {
        status.innerHTML = `No comments yet. Post on <a href="${gistUrl}" target="_blank" rel="noreferrer">GitHub</a> and new replies will appear here.`;
      } else {
        status.textContent = "Showing cached comments. GitHub could not be reached just now.";
      }

      status.hidden = false;
      return;
    }

    status.innerHTML = `Comments could not be loaded here. Continue on <a href="${gistUrl}" target="_blank" rel="noreferrer">GitHub</a>.`;
  }
};

const init = () => {
  syncNavigation();
  setupPermalinkButtons();
  setupTocTitleVisibility();
  setupDrawer();
  setupDesktopContextPrompt();
  setupMobileContextPrompt();
  void setupDiscussion();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
