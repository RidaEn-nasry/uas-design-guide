const guide = window.GUIDE_DATA;

const lessonList = document.querySelector("#lessonList");
const lessonGroup = document.querySelector("#lessonGroup");
const lessonTitle = document.querySelector("#lessonTitle");
const lessonMeta = document.querySelector("#lessonMeta");
const lessonContent = document.querySelector("#lessonContent");
const guideCount = document.querySelector("#guideCount");
const lessonDoneToggle = document.querySelector("#lessonDoneToggle");
const footerPrevLesson = document.querySelector("#footerPrevLesson");
const footerNextLesson = document.querySelector("#footerNextLesson");
const readingProgressBar = document.querySelector("#readingProgressBar");
const highlightPopover = document.querySelector("#highlightPopover");
const figureLightbox = document.querySelector("#figureLightbox");
const figureLightboxImage = document.querySelector("#figureLightboxImage");
const figureLightboxCaption = document.querySelector("#figureLightboxCaption");
const figureLightboxClose = document.querySelector("#figureLightboxClose");

const READING_STATE_KEY = "uas-design-guide-reading-state";
const DONE_STATE_KEY = "uas-design-guide-done-lessons";
const HIGHLIGHT_STATE_KEY = "uas-design-guide-highlights";
const lessonSearch = document.querySelector("#lessonSearch");
const searchStatus = document.querySelector("#searchStatus");
const sourcePage = document.querySelector("#sourcePage");
const searchIndex = new Map(guide.lessons.map(lesson => [lesson.id, `${lesson.title} ${lesson.group} ${lesson.markdown}`.toLowerCase()]));
let lastFigure = null;
const params = new URLSearchParams(window.location.search);
const savedState = readReadingState();
let doneLessons = readDoneLessons();
let lessonHighlights = readLessonHighlights();
const requestedLessonId = params.get("lesson") || savedState.lessonId || guide.lessons.find(lesson => lesson.kind === "overview")?.id;
let activeIndex = Math.max(
  0,
  guide.lessons.findIndex((lesson) => lesson.id === requestedLessonId),
);
let saveScrollTimer;

function readReadingState() {
  try {
    return JSON.parse(window.localStorage.getItem(READING_STATE_KEY)) || {};
  } catch {
    return {};
  }
}

function writeReadingState(state) {
  try {
    window.localStorage.setItem(READING_STATE_KEY, JSON.stringify(state));
  } catch {
    // Reading progress is a convenience. The guide still works if storage is blocked.
  }
}

function readDoneLessons() {
  try {
    const value = JSON.parse(window.localStorage.getItem(DONE_STATE_KEY));
    return new Set(Array.isArray(value) ? value : []);
  } catch {
    return new Set();
  }
}

function writeDoneLessons() {
  try {
    window.localStorage.setItem(DONE_STATE_KEY, JSON.stringify([...doneLessons]));
  } catch {
    // Completion state is local-only. The guide still works if storage is blocked.
  }
}

function readLessonHighlights() {
  try {
    const value = JSON.parse(window.localStorage.getItem(HIGHLIGHT_STATE_KEY));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeLessonHighlights() {
  try {
    window.localStorage.setItem(HIGHLIGHT_STATE_KEY, JSON.stringify(lessonHighlights));
  } catch {
    // Highlights are local-only. The guide still works if storage is blocked.
  }
}

function getActiveLessonHighlights() {
  const lesson = guide.lessons[activeIndex];
  return lesson ? lessonHighlights[lesson.id] || [] : [];
}

function setActiveLessonHighlights(highlights) {
  const lesson = guide.lessons[activeIndex];
  if (!lesson) {
    return;
  }

  if (highlights.length === 0) {
    delete lessonHighlights[lesson.id];
  } else {
    lessonHighlights[lesson.id] = highlights;
  }
  writeLessonHighlights();
}

function updateGuideCount() {
  const doneCount = doneLessons.size;
  guideCount.textContent = doneCount
    ? `${doneCount} done / ${guide.lessons.length} lessons`
    : `${guide.lessons.length} lessons`;
}

function updateDoneToggle(lesson) {
  const isDone = doneLessons.has(lesson.id);
  lessonDoneToggle.classList.toggle("is-done", isDone);
  lessonDoneToggle.setAttribute("aria-pressed", String(isDone));
  lessonDoneToggle.setAttribute("aria-label", isDone ? "Mark unfinished" : "Mark done");
  lessonDoneToggle.title = isDone ? "Mark unfinished" : "Mark done";
}

function saveReadingState(scrollY = window.scrollY) {
  const lesson = guide.lessons[activeIndex];
  if (!lesson) {
    return;
  }

  writeReadingState({
    lessonId: lesson.id,
    scrollY: Math.max(0, Math.round(scrollY)),
    updatedAt: Date.now(),
  });
}

function scheduleReadingStateSave() {
  window.clearTimeout(saveScrollTimer);
  saveScrollTimer = window.setTimeout(() => saveReadingState(), 140);
}

function updateReadingProgress() {
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  const progress = maxScroll > 0 ? Math.min(Math.max(window.scrollY / maxScroll, 0), 1) : 1;
  readingProgressBar.style.transform = `scaleY(${progress})`;
}

function slugToIndex(slug) {
  const index = guide.lessons.findIndex((lesson) => lesson.id === slug);
  return index >= 0 ? index : 0;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderInline(markdown) {
  let html = escapeHtml(markdown);

  html = html.replace(/&lt;br\s*\/?&gt;/gi, "<br>");
  html = html.replace(/&lt;(\/?)(sup|sub)&gt;/gi, "<$1$2>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/_([^_]+)_/g, "<em>$1</em>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
    if (!/^(https?:|mailto:|#)/i.test(href)) return label;
    const safeHref = href;
    return `<a href="${safeHref}" target="_blank" rel="noopener">${label}</a>`;
  });

  return html;
}

function renderList(lines, ordered) {
  const tag = ordered ? "ol" : "ul";
  const items = lines
    .map((line) => {
      const text = line.replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, "");
      return `<li>${renderInline(text)}</li>`;
    })
    .join("");

  return `<${tag}>${items}</${tag}>`;
}

function renderTable(lines) {
  const rows = lines
    .filter((line) => !/^\s*\|?\s*:?-{3,}/.test(line))
    .map((line) =>
      line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    );

  if (rows.length === 0) {
    return "";
  }

  const [header, ...body] = rows;
  const headHtml = header.map((cell) => `<th>${renderInline(cell)}</th>`).join("");
  const bodyHtml = body
    .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`)
    .join("");

  return `<div class="table-scroll"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}

function renderMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trimEnd();

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(
        `<div class="code-block"><button class="copy-code" type="button" aria-label="Copy code">Copy</button><pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre></div>`,
      );
      continue;
    }

    const imageMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imageMatch) {
      const [, alt, src] = imageMatch;
      let caption = "";
      let nextIndex = index + 1;
      while (nextIndex < lines.length && !lines[nextIndex].trim()) {
        nextIndex += 1;
      }
      const nextLine = lines[nextIndex]?.trim();
      if (nextLine?.match(/^(?:_Figure.+_|\*\*Figure\s[\s\S]+|Figure\s[\s\S]+)$/)) {
        caption = `<figcaption>${renderInline(nextLine.replace(/^_/, "").replace(/_$/, ""))}</figcaption>`;
        index = nextIndex;
      }
      blocks.push(
        `<figure><img loading="lazy" decoding="async" tabindex="0" role="button" aria-label="Expand figure" ${guide.imageSizes?.[src] ? `width="${guide.imageSizes[src][0]}" height="${guide.imageSizes[src][1]}"` : ""} src="${escapeHtml(src)}" alt="${escapeHtml(alt || "Book illustration or equation")}">${caption}</figure>`,
      );
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const depth = Math.min(heading[1].length + 1, 4);
      blocks.push(`<h${depth}>${renderInline(heading[2])}</h${depth}>`);
      index += 1;
      continue;
    }

    if (/^\|.+\|$/.test(line) && /^\|?[\s:|-]+\|/.test(lines[index + 1] || "")) {
      const tableLines = [line];
      index += 1;
      while (index < lines.length && /^\|.+\|$/.test(lines[index].trim())) {
        tableLines.push(lines[index].trim());
        index += 1;
      }
      blocks.push(renderTable(tableLines));
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim());
        index += 1;
      }
      blocks.push(renderList(items, true));
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim());
        index += 1;
      }
      blocks.push(renderList(items, false));
      continue;
    }

    if (/^>\s+/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s+/.test(lines[index].trim())) {
        quote.push(lines[index].trim().replace(/^>\s+/, ""));
        index += 1;
      }
      blocks.push(`<blockquote><p>${renderInline(quote.join(" "))}</p></blockquote>`);
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,4})\s+/.test(lines[index].trim()) &&
      !/^```/.test(lines[index].trim()) &&
      !/^!\[/.test(lines[index].trim()) &&
      !/^\d+\.\s+/.test(lines[index].trim()) &&
      !/^[-*]\s+/.test(lines[index].trim()) &&
      !/^\|.+\|$/.test(lines[index].trim())
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }

  return blocks.join("\n");
}

function isHighlightBlockedElement(element) {
  if (!element) {
    return true;
  }

  return Boolean(
    element.closest(
      ".code-block, .copy-code, figure, button, input, textarea, select, .figure-lightbox",
    ),
  );
}

function selectionInsideLesson(selection) {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return false;
  }

  const range = selection.getRangeAt(0);
  const blockedContent = lessonContent.querySelectorAll(".code-block, figure, button");
  return (
    lessonContent.contains(range.startContainer) &&
    lessonContent.contains(range.endContainer) &&
    ![...blockedContent].some((element) => range.intersectsNode(element)) &&
    !isHighlightBlockedElement(
      range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement,
    )
  );
}

function getSelectionDescriptor() {
  const selection = window.getSelection();
  if (!selectionInsideLesson(selection)) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const rawText = range.toString();
  const text = rawText.trim();
  if (text.length < 2) {
    return null;
  }

  const leadingWhitespace = rawText.length - rawText.trimStart().length;
  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(lessonContent);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const start = beforeRange.toString().length + leadingWhitespace;
  const end = start + text.length;

  return { end, range, start, text };
}

function hideHighlightPopover() {
  highlightPopover.hidden = true;
}

function positionHighlightPopover() {
  const descriptor = getSelectionDescriptor();
  if (!descriptor) {
    hideHighlightPopover();
    return;
  }

  const rect = descriptor.range.getBoundingClientRect();
  if (!rect.width && !rect.height) {
    hideHighlightPopover();
    return;
  }

  const left = Math.min(Math.max(rect.left + rect.width / 2, 54), window.innerWidth - 54);
  const top = Math.max(rect.top - 40, 10);

  highlightPopover.style.left = `${left}px`;
  highlightPopover.style.top = `${top}px`;
  highlightPopover.hidden = false;
}

function highlightOverlaps(start, end) {
  return getActiveLessonHighlights().some((highlight) => start < highlight.end && highlight.start < end);
}

function renderActiveLessonContent() {
  const lesson = guide.lessons[activeIndex];
  lessonContent.innerHTML = renderMarkdown(lesson.markdown);
  applyLessonHighlights(lesson.id);
}

function addSelectionHighlight() {
  const descriptor = getSelectionDescriptor();
  if (!descriptor || highlightOverlaps(descriptor.start, descriptor.end)) {
    hideHighlightPopover();
    window.getSelection()?.removeAllRanges();
    return;
  }

  const highlights = getActiveLessonHighlights();
  highlights.push({
    createdAt: Date.now(),
    end: descriptor.end,
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    start: descriptor.start,
    text: descriptor.text,
  });
  highlights.sort((left, right) => left.start - right.start);
  setActiveLessonHighlights(highlights);

  const scrollY = window.scrollY;
  renderActiveLessonContent();
  window.scrollTo({ top: scrollY, behavior: "auto" });
  hideHighlightPopover();
  window.getSelection()?.removeAllRanges();
}

function removeHighlight(highlightId) {
  const highlights = getActiveLessonHighlights().filter((highlight) => highlight.id !== highlightId);
  setActiveLessonHighlights(highlights);

  const scrollY = window.scrollY;
  renderActiveLessonContent();
  window.scrollTo({ top: scrollY, behavior: "auto" });
}

function wrapTextSegment(textNode, startOffset, endOffset, highlightId) {
  const range = document.createRange();
  range.setStart(textNode, startOffset);
  range.setEnd(textNode, endOffset);

  const mark = document.createElement("mark");
  mark.className = "reader-highlight";
  mark.dataset.highlightId = highlightId;
  mark.title = "Click to remove highlight";
  range.surroundContents(mark);
}

function applyHighlightRange(highlight) {
  const walker = document.createTreeWalker(lessonContent, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node);
    node = walker.nextNode();
  }

  let cursor = 0;
  nodes.forEach((textNode) => {
    const textLength = textNode.nodeValue.length;
    const nodeStart = cursor;
    const nodeEnd = cursor + textLength;
    cursor = nodeEnd;

    if (highlight.end <= nodeStart || highlight.start >= nodeEnd) {
      return;
    }

    if (textNode.parentElement?.closest(".reader-highlight, .copy-code, button")) {
      return;
    }

    const startOffset = Math.max(0, highlight.start - nodeStart);
    const endOffset = Math.min(textLength, highlight.end - nodeStart);
    if (startOffset >= endOffset) {
      return;
    }

    wrapTextSegment(textNode, startOffset, endOffset, highlight.id);
  });
}

function applyLessonHighlights(lessonId) {
  const highlights = lessonHighlights[lessonId] || [];
  [...highlights]
    .sort((left, right) => right.start - left.start)
    .forEach((highlight) => {
      const currentText = lessonContent.textContent.slice(highlight.start, highlight.end);
      if (currentText === highlight.text) {
        applyHighlightRange(highlight);
      }
    });
}

function fallbackCopyText(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

async function copyCode(button) {
  const code = button.closest(".code-block")?.querySelector("code");
  if (!code) {
    return;
  }

  const originalText = button.textContent;
  const codeText = code.textContent;
  let copied = false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(codeText);
      copied = true;
    }
  } catch {
    copied = false;
  }

  if (!copied) {
    try {
      copied = fallbackCopyText(codeText);
    } catch {
      copied = false;
    }
  }

  button.textContent = copied ? "Copied" : "Failed";

  window.setTimeout(() => {
    button.textContent = originalText;
  }, 1200);
}

function openFigureLightbox(image) {
  lastFigure = image;
  const figure = image.closest("figure");
  const caption = figure?.querySelector("figcaption")?.textContent.trim() || "";

  figureLightboxImage.src = image.currentSrc || image.src;
  figureLightboxImage.alt = image.alt || "Figure";
  figureLightboxCaption.textContent = caption;
  figureLightboxCaption.hidden = !caption;
  figureLightbox.hidden = false;
  document.body.classList.add("has-lightbox");
  figureLightboxClose.focus();
}

function closeFigureLightbox() {
  figureLightbox.hidden = true;
  figureLightboxImage.removeAttribute("src");
  figureLightboxCaption.textContent = "";
  document.body.classList.remove("has-lightbox");
  lastFigure?.focus();
}

function groupedLessons(lessons) {
  const groups = [];
  lessons.forEach((lesson) => {
    let group = groups.find((item) => item.title === lesson.group);
    if (!group) {
      group = { title: lesson.group, lessons: [] };
      groups.push(group);
    }
    group.lessons.push(lesson);
  });
  return groups;
}

function renderLessonList(filter = lessonSearch.value) {
  const normalized = filter.trim().toLowerCase();
  const visibleLessons = guide.lessons.filter((lesson) => {
    return normalized.split(/\s+/).every(term => searchIndex.get(lesson.id).includes(term));
  });

  lessonList.innerHTML = "";
  searchStatus.textContent = normalized ? `${visibleLessons.length} matching sections` : "";

  if (visibleLessons.length === 0) {
    lessonList.innerHTML = '<p class="empty-state">No matching lessons.</p>';
    return;
  }

  groupedLessons(visibleLessons).forEach((group) => {
    const section = document.createElement("section");
    section.className = "nav-group";

    const title = document.createElement("h3");
    title.textContent = group.title;
    section.append(title);

    const list = document.createElement("ol");
    group.lessons.forEach((lesson) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = `?lesson=${lesson.id}`;
      link.textContent = lesson.kind === "overview" ? "Chapter overview" : lesson.title;
      if (lesson.id === guide.lessons[activeIndex].id) link.setAttribute("aria-current", "page");
      link.className = [
        lesson.id === guide.lessons[activeIndex].id ? "is-active" : "",
        doneLessons.has(lesson.id) ? "is-done" : "",
      ]
        .filter(Boolean)
        .join(" ");
      link.addEventListener("click", (event) => {
        event.preventDefault();
        selectLesson(slugToIndex(lesson.id));
      });
      item.append(link);
      list.append(item);
    });

    section.append(list);
    lessonList.append(section);
  });
}

function selectLesson(index, options = {}) {
  hideHighlightPopover();
  activeIndex = Math.min(Math.max(index, 0), guide.lessons.length - 1);
  const lesson = guide.lessons[activeIndex];
  const previous = guide.lessons[activeIndex - 1];
  const next = guide.lessons[activeIndex + 1];

  lessonGroup.textContent = lesson.group;
  lessonTitle.textContent = lesson.title;
  lessonMeta.textContent = `Section ${activeIndex + 1} of ${guide.lessons.length} · ${Math.max(1, Math.ceil(lesson.markdown.split(/\s+/).length / 230))} min read`;
  sourcePage.href = `book.pdf#page=${lesson.pdfPage}`;
  sourcePage.textContent = `Book pages ${lesson.pdfPage}–${lesson.pdfEndPage}`;
  document.title = `${lesson.title} · UAS Design Guide`;
  renderActiveLessonContent();
  updateDoneToggle(lesson);
  footerPrevLesson.disabled = activeIndex === 0;
  footerNextLesson.disabled = activeIndex === guide.lessons.length - 1;
  footerPrevLesson.textContent = previous ? `Previous: ${previous.title}` : "Previous";
  footerNextLesson.textContent = next ? `Next: ${next.title}` : "Next";
  footerPrevLesson.title = previous?.title || "";
  footerNextLesson.title = next?.title || "";

  const url = new URL(window.location.href);
  url.searchParams.set("lesson", lesson.id);
  if (!options.historyNavigation) {
    window.history[options.initial ? "replaceState" : "pushState"]({ lesson: lesson.id }, "", url);
  }

  renderLessonList();

  window.requestAnimationFrame(() => {
    if (typeof options.restoreScrollY === "number") {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const scrollY = Math.min(Math.max(0, options.restoreScrollY), Math.max(0, maxScroll));
      window.scrollTo({ top: scrollY, behavior: "auto" });
      saveReadingState(scrollY);
      updateReadingProgress();
      return;
    }

    window.scrollTo({ top: 0, behavior: options.smooth === false ? "auto" : "smooth" });
    saveReadingState(0);
    updateReadingProgress();
  });
}

function navigateByKeyboard(delta) {
  const nextIndex = activeIndex + delta;
  if (nextIndex < 0 || nextIndex >= guide.lessons.length) {
    return false;
  }

  selectLesson(nextIndex);
  return true;
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);
}

footerPrevLesson.addEventListener("click", () => {
  selectLesson(activeIndex - 1);
});

footerNextLesson.addEventListener("click", () => {
  selectLesson(activeIndex + 1);
});

lessonDoneToggle.addEventListener("click", () => {
  const lesson = guide.lessons[activeIndex];
  if (doneLessons.has(lesson.id)) {
    doneLessons.delete(lesson.id);
  } else {
    doneLessons.add(lesson.id);
  }

  writeDoneLessons();
  updateDoneToggle(lesson);
  updateGuideCount();
  renderLessonList();
});

highlightPopover.addEventListener("mousedown", (event) => {
  event.preventDefault();
});

highlightPopover.addEventListener("click", addSelectionHighlight);

lessonContent.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const highlight = target.closest(".reader-highlight");
  if (highlight) {
    removeHighlight(highlight.dataset.highlightId);
    return;
  }

  const copyButton = target.closest(".copy-code");
  if (copyButton) {
    copyCode(copyButton);
    return;
  }

  const figureImage = target.closest("figure img");
  if (figureImage) {
    openFigureLightbox(figureImage);
  }
});

lessonContent.addEventListener("keydown", (event) => {
  if (event.target.matches("figure img") && ["Enter", " "].includes(event.key)) {
    event.preventDefault();
    openFigureLightbox(event.target);
  }
});

figureLightbox.addEventListener("click", (event) => {
  if (event.target === figureLightbox) {
    closeFigureLightbox();
  }
});

figureLightboxClose.addEventListener("click", closeFigureLightbox);
window.addEventListener(
  "scroll",
  () => {
    scheduleReadingStateSave();
    updateReadingProgress();
    hideHighlightPopover();
  },
  { passive: true },
);
document.addEventListener("selectionchange", positionHighlightPopover);
window.addEventListener("beforeunload", () => saveReadingState());
window.addEventListener("pagehide", () => saveReadingState());
document.addEventListener("keydown", (event) => {
  if (!figureLightbox.hidden && event.key === "Escape") {
    closeFigureLightbox();
    event.preventDefault();
    return;
  }

  if (
    event.defaultPrevented ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    !figureLightbox.hidden ||
    isEditableTarget(event.target)
  ) {
    return;
  }

  const previousKeys = new Set(["ArrowLeft", "[", "k"]);
  const nextKeys = new Set(["ArrowRight", "]", "j"]);
  let handled = false;

  if (previousKeys.has(event.key)) {
    handled = navigateByKeyboard(-1);
  } else if (nextKeys.has(event.key)) {
    handled = navigateByKeyboard(1);
  }

  if (handled) {
    event.preventDefault();
  }
});

lessonSearch.addEventListener("input", () => renderLessonList());
window.addEventListener("popstate", () => selectLesson(slugToIndex(new URLSearchParams(location.search).get("lesson")), { historyNavigation: true, smooth: false }));
updateGuideCount();
renderLessonList();
const shouldRestoreSavedScroll = savedState.lessonId === guide.lessons[activeIndex]?.id;
selectLesson(activeIndex, {
  initial: true,
  restoreScrollY: shouldRestoreSavedScroll ? savedState.scrollY : undefined,
  smooth: false,
});
