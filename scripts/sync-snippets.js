const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const SNIPPET_API_BASE_URL = process.env.SNIPPET_API_BASE_URL;
const SNIPPET_API_TOKEN = process.env.SNIPPET_API_TOKEN;

// ---------- 공통 유틸 ----------
function getTitle(prop) {
  return prop?.title?.map(t => t.plain_text).join("") || "";
}

function getRichText(prop) {
  return prop?.rich_text?.map(t => t.plain_text).join("") || "";
}

// 여러 줄 텍스트를 bullet 리스트용 배열로 정리
function parseLines(raw = "") {
  return raw
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, ""));
}

// 일반 bullet 섹션 만들기
function buildBulletSection(title, raw = "") {
  const lines = parseLines(raw);

  if (lines.length === 0) return "";

  return [
    `## ${title}`,
    ...lines.map(line => `- ${line}`),
    ""
  ].join("\n");
}

// 체크박스 섹션 만들기
function buildCheckboxSection(title, raw = "") {
  const lines = parseLines(raw);

  if (lines.length === 0) return "";

  return [
    `## ${title}`,
    ...lines.map(line => `- [ ] ${line}`),
    ""
  ].join("\n");
}

// ---------- Notion 조회 ----------
async function queryNotion(filter) {
  const res = await fetch(
    `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filter }),
    }
  );

  const data = await res.json();

  console.log("=== Notion query 응답 ===");
  console.log(JSON.stringify(data, null, 2));

  if (!res.ok) {
    throw new Error(`Notion query 실패: ${res.status} / ${JSON.stringify(data)}`);
  }

  return data.results || [];
}

// 상태=완료, 전송완료=false 인 행만 가져오기
async function getPendingRows() {
  return queryNotion({
    and: [
      {
        property: "상태",
        status: { equals: "완료" },
      },
      {
        property: "전송완료",
        checkbox: { equals: false },
      },
    ],
  });
}

// ---------- 1000.school 전송 ----------
async function createDailySnippet(content) {
  const res = await fetch(`${SNIPPET_API_BASE_URL}/daily-snippets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SNIPPET_API_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ content }),
  });

  const text = await res.text();

  console.log("=== POST 상태 ===", res.status);
  console.log("=== POST 원문 응답 ===", text);

  if (!res.ok) {
    throw new Error(`daily-snippets POST 실패: ${res.status} / ${text}`);
  }

  let data = {};
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = { raw: text };
  }

  console.log("=== POST 응답 JSON ===");
  console.log(JSON.stringify(data, null, 2));

  const snippetId =
    data?.id ??
    data?.snippet_id ??
    data?.daily_snippet_id ??
    data?.data?.id ??
    data?.data?.snippet_id ??
    null;

  console.log("snippetId:", snippetId);

  return { data, snippetId };
}

// ---------- Notion 업데이트 ----------
async function markAsSent(pageId, snippetId = null) {
  const body = {
    properties: {
      전송완료: { checkbox: true },
    },
  };

  if (snippetId) {
    body.properties["snippet_id"] = {
      rich_text: [{ text: { content: String(snippetId) } }],
    };
  }

  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  console.log("=== Notion 업데이트 응답 ===");
  console.log(JSON.stringify(data, null, 2));

  if (!res.ok) {
    throw new Error(`Notion 업데이트 실패: ${res.status} / ${JSON.stringify(data)}`);
  }
}

// ---------- 최종 content 조립 ----------
function buildFinalContent(props) {
  const title = getTitle(props["제목"]);

  const sections = [];

  if (title) {
    sections.push(`## 제목\n${title}\n`);
  }

  sections.push(buildBulletSection("오늘 한 일", getRichText(props["오늘 한 일"])));
  sections.push(buildBulletSection("수행 목적", getRichText(props["수행 목적"])));
  sections.push(buildBulletSection("하이라이트", getRichText(props["하이라이트"])));
  sections.push(buildBulletSection("로우라이트", getRichText(props["로우라이트"])));

  // 내일 할일은 체크박스 스타일
  sections.push(buildCheckboxSection("내일 할일", getRichText(props["내일 할일"])));

  sections.push(
    buildBulletSection(
      "오늘 내가 팀에 기여한 가치",
      getRichText(props["오늘 내가 팀에 기여한 가치"])
    )
  );

  sections.push(
    buildBulletSection(
      "오늘의 배움 또는 남길 말",
      getRichText(props["오늘의 배움 또는 남길 말"])
    )
  );

  return sections.filter(Boolean).join("\n").trim();
}

// ---------- 메인 ----------
async function main() {
  const items = await getPendingRows();
  console.log("가져온 개수:", items.length);

  if (items.length === 0) {
    console.log("전송할 노션 데이터가 없습니다.");
    return;
  }

  for (const item of items) {
    const props = item.properties;

    const finalContent = buildFinalContent(props);

    console.log("=== 최종 전송 content ===");
    console.log(finalContent);

    const { snippetId } = await createDailySnippet(finalContent);
    await markAsSent(item.id, snippetId);
  }
}

function normalizeText(text = "") {
  return text
    .toLowerCase()
    .replace(/[^\w가-힣\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractKeywords(line = "") {
  const normalized = normalizeText(line);

  // 너무 짧은 조사/불용어는 제외
  const stopwords = new Set([
    "하기", "하기를", "이상", "정도", "관련", "통해", "및", "그리고",
    "오늘", "내일", "한", "할", "수", "것", "등", "더", "잘"
  ]);

  return normalized
    .split(" ")
    .map(w => w.trim())
    .filter(w => w.length >= 2 && !stopwords.has(w));
}

main().catch((err) => {
  console.error("실행 중 오류:", err);
  process.exit(1);
});
