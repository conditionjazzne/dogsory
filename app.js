// 1) Supabase Dashboard > Project Settings > API에서 복사한 값을 넣으세요.
// 2) service_role / secret 키는 절대 여기에 넣지 마세요.
const SUPABASE_URL = "https://lcfoivjdnpyukoinqunw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_VJF_Aj0oWPEDPvejWeVOcw_qBsh95EA";

const MAX_LENGTH = 100;
const PAGE_SIZE = 40;

const form = document.querySelector("#post-form");
const input = document.querySelector("#post-input");
const counter = document.querySelector("#counter");
const message = document.querySelector("#form-message");
const button = document.querySelector("#submit-button");
const feed = document.querySelector("#feed");
const feedStatus = document.querySelector("#feed-status");
const feedCount = document.querySelector("#feed-count");
const sentinel = document.querySelector("#scroll-sentinel");

let supabaseClient;
let offset = 0;
let totalLoaded = 0;
let hasMore = true;
let loading = false;

function configured() {
  return !SUPABASE_URL.startsWith("YOUR_") &&
         !SUPABASE_PUBLISHABLE_KEY.startsWith("YOUR_");
}
function setMessage(text = "", type = "") {
  message.textContent = text;
  message.className = type;
}
function updateCounter() {
  counter.textContent = `${input.value.length} / ${MAX_LENGTH}`;
}
function cleanText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function isDisallowed(text) {
 const normalized = text
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.,!?~`'"“”‘’()[\]{}<>|\\/_\-+=:;@#$%^&*]/g, "");
  // 연락처, 이메일, 링크 차단
  const phone = /(?:01[016789]-?\d{3,4}-?\d{4})/;
  const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const url = /\bhttps?:\/\/\S+/i;
  if (phone.test(text) || email.test(text) || url.test(text)) {
    return "연락처·이메일·링크는 올릴 수 없습니다.";
  }
  // 욕설·비하 표현 필터
  const bannedWords = [
    "씨발", "시발", "ㅅㅂ", "ㅆㅂ",
    "병신", "븅신", "ㅂㅅ",
    "개새끼", "새끼", "꺼져",
    "좆", "존나", "ㅈㄴ",
    "죽어", "뒤져",
    "미친놈", "미친년",
    "년놈", "년아", "놈아"
  ];
  if (bannedWords.some((word) => normalized.includes(word))) {
    return "욕설·비하·위협적인 표현은 올릴 수 없습니다.";
  }
  // 같은 글자 반복 차단: ㅋㅋㅋㅋㅋㅋ, ㅏㅏㅏㅏㅏ, aaaaaa 등
  if (/(.)\1{5,}/.test(normalized)) {
    return "같은 문자를 과도하게 반복한 글은 올릴 수 없습니다.";
  }
  // 자음/모음만 긴 글 차단: ㅋㅋㅋㅋ, ㅁㄴㅇㄹ, ㅏㅏㅗㅓ 등
  const onlyJamo = /^[ㄱ-ㅎㅏ-ㅣ]+$/;
  if (onlyJamo.test(normalized) && normalized.length >= 4) {
    return "의미 없는 자음·모음 나열은 올릴 수 없습니다.";
  }
  // 영문/숫자 랜덤 문자열 차단: asdfasdf, qwerqwer, aaa123 같은 느낌
  const onlyAlphaNumber = /^[a-z0-9]+$/;
  const hasKorean = /[가-힣]/.test(text);
  if (!hasKorean && onlyAlphaNumber.test(normalized) && normalized.length >= 8) {
    return "의미 없는 문자 나열은 올릴 수 없습니다.";
  }

  // 한글 완성형 없이 특수문자/자모 중심이면 차단
  const meaningfulKorean = /[가-힣]/.test(text);
  const meaningfulEnglish = /[a-zA-Z]{2,}/.test(text);
  if (!meaningfulKorean && !meaningfulEnglish) {
    return "의미 있는 문장을 입력해 주세요.";
  }
  return "";
}


function formatTime(iso) {
  const date = new Date(iso);
  const now = new Date();
  const seconds = Math.max(0, Math.floor((now - date) / 1000));
  if (seconds < 60) return "방금 전";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 전`;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(date);
}

function postElement(post) {
  const article = document.createElement("article");
  article.className = "post";

  const text = document.createElement("p");
  text.className = "post-text";
  text.textContent = post.body;

  const time = document.createElement("time");
  time.className = "post-time";
  time.dateTime = post.created_at;
  time.textContent = formatTime(post.created_at);

  article.append(text, time);
  return article;
}

async function ensureAnonymousSession() {
  const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
  if (sessionError) throw sessionError;
  if (session) return;

  const { error } = await supabaseClient.auth.signInAnonymously();
  if (error) throw error;
}

async function loadPosts({ reset = false } = {}) {
  if (loading || (!hasMore && !reset)) return;
  loading = true;

  if (reset) {
    offset = 0;
    totalLoaded = 0;
    hasMore = true;
    feed.replaceChildren();
  }

  feedStatus.textContent = totalLoaded ? "더 불러오는 중입니다." : "글을 불러오는 중입니다.";

  const { data, error } = await supabaseClient
    .from("posts")
    .select("id, body, created_at")
    .eq("is_hidden", false)
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  loading = false;

  if (error) {
    feedStatus.textContent = "글을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.";
    return;
  }

  data.forEach((post) => feed.append(postElement(post)));
  totalLoaded += data.length;
  offset += data.length;
  hasMore = data.length === PAGE_SIZE;

  feedCount.textContent = totalLoaded ? `${totalLoaded}개 표시 중` : "";

  if (totalLoaded === 0) {
    feed.innerHTML = '<p class="empty">아직 남겨진 소리가 없습니다. 첫 번째로 남겨보세요.</p>';
    feedStatus.textContent = "";
  } else if (hasMore) {
    feedStatus.textContent = "아래로 스크롤하면 더 불러옵니다.";
  } else {
    feedStatus.textContent = "여기까지입니다.";
  }
}

async function submitPost(event) {
  event.preventDefault();
  const body = cleanText(input.value);

  if (!body) {
    setMessage("한마디를 입력해 주세요.", "error");
    input.focus();
    return;
  }

  if (body.length > MAX_LENGTH) {
    setMessage("100자 안으로 작성해 주세요.", "error");
    return;
  }

 const disallowedMessage = isDisallowed(body);
 if (disallowedMessage) {
 setMessage(disallowedMessage, "error");
  return;
}

  button.disabled = true;
  setMessage("남기는 중입니다.");

  try {
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError) throw userError;
    if (!user) throw new Error("익명 세션을 만들 수 없습니다.");

    const { data, error } = await supabaseClient
      .from("posts")
      .insert({ body, author_id: user.id })
      .select("id, body, created_at")
      .single();

    if (error) {
      // SQL의 30초 제한 오류 문구를 사용자에게 친절하게 변환합니다.
      if (error.message.includes("30 seconds")) {
        throw new Error("같은 브라우저에서는 30초에 한 번만 남길 수 있습니다.");
      }
      throw error;
    }

    input.value = "";
    updateCounter();
    setMessage("남겨졌습니다.", "success");
    feed.querySelector(".empty")?.remove();
    feed.prepend(postElement(data));
    totalLoaded += 1;
    feedCount.textContent = `${totalLoaded}개 표시 중`;
  } catch (error) {
    console.error(error);
    setMessage(error.message || "등록에 실패했습니다. 잠시 후 다시 시도해 주세요.", "error");
  } finally {
    button.disabled = false;
  }
}

async function start() {
  updateCounter();

  if (!configured()) {
    feedStatus.textContent = "설정이 아직 완료되지 않았습니다. README의 2단계를 진행해 주세요.";
    setMessage("Supabase URL과 Publishable Key를 먼저 넣어 주세요.", "error");
    button.disabled = true;
    return;
  }

  supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }
  );

  try {
    await ensureAnonymousSession();
    await loadPosts();
  } catch (error) {
    console.error(error);
    feedStatus.textContent = "익명 연결을 만들 수 없습니다. Supabase 설정을 확인해 주세요.";
  }
}

input.addEventListener("input", updateCounter);
form.addEventListener("submit", submitPost);

new IntersectionObserver(([entry]) => {
  if (entry.isIntersecting) loadPosts();
}, { rootMargin: "420px" }).observe(sentinel);

start();
