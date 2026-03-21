const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const SNIPPET_API_BASE_URL = process.env.SNIPPET_API_BASE_URL;
const SNIPPET_API_TOKEN = process.env.SNIPPET_API_TOKEN;

// ---------- 유틸 ----------
function getTitle(prop) {
  return prop?.title?.map(t => t.plain_text).join("") || "";
}

function getRichText(prop) {
  return prop?.rich_text?.map(t => t.plain_text).join("") || "";
}

function getPeopleNames(prop) {
  return prop?.people?.map(p => p.name).join(", ") || "";
}

function getAuthor(props) {
  return getRichText(props["작성자"]) || getPeopleNames(props["작성자"]);
}

function minusOneDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// 여러 줄 텍스트를 bullet 배열로 정리
function parseLines(raw = "") {
  return raw
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, ""));
}

// 오늘 한 일 자동 구조화
function buildTodayWorkSection(raw = "") {
  const lines = parseLines(raw);

  if (lines.length === 0) {
    return `## 오늘 한 일\n- (내용 없음)`;
  }

  return `## 오늘 한 일\n${lines.map(line => `- ${line}`).join("\n")}`;
}

// 전날 한 일 체크박스화
function buildYesterdayChecklist(raw = "") {
  const lines = parseLines(raw);

  if (lines.length === 0) {
    return `## 전날 한 일 체크리스트\n- [ ] 전날 기록 없음`;
  }

  return `## 전날 한 일 체크리스트\n${lines.map(line => `- [ ] ${line}`).join("\n")}`;
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

// 오늘 전송할 행
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

// 특정 날짜의 행 하나 찾기
async function getRowByDate(dateStr) {
  const rows = await queryNotion({
    property: "기록일자",
    date: { equals: dateStr },
  });

  return rows[0] || null;
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
function buildFinalContent({
  title,
  author,
  team,
  todayRaw,
  yesterdayRaw,
  recordDate,
}) {
  const yesterdaySection = buildYesterdayChecklist(yesterdayRaw);
  const todaySection = buildTodayWorkSection(todayRaw);

  return [
    `## 제목`,
    `${title}`,
    ``,
    `작성자: ${author || "-"}`,
    `팀: ${team || "-"}`,
    `기록일자: ${recordDate || "-"}`,
    ``,
    yesterdaySection,
    ``,
    todaySection,
  ].join("\n");
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

    const title = getTitle(props["제목"]);
    const todayRaw = getRichText(props["내용"]);
    const author = getAuthor(props);
    const team = getRichText(props["팀명"]);
    const recordDate = props["기록일자"]?.date?.start || "";

    let yesterdayRaw = "";
    if (recordDate) {
      const prevDate = minusOneDay(recordDate);
      const prevRow = await getRowByDate(prevDate);

      if (prevRow) {
        yesterdayRaw = getRichText(prevRow.properties["내용"]);
      }
    }

    const finalContent = buildFinalContent({
      title,
      author,
      team,
      todayRaw,
      yesterdayRaw,
      recordDate,
    });

    console.log("=== 최종 전송 content ===");
    console.log(finalContent);

    const { snippetId } = await createDailySnippet(finalContent);
    await markAsSent(item.id, snippetId);
  }
}

main().catch((err) => {
  console.error("실행 중 오류:", err);
  process.exit(1);
});
