const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const SNIPPET_API_BASE_URL = process.env.SNIPPET_API_BASE_URL;
const SNIPPET_API_TOKEN = process.env.SNIPPET_API_TOKEN;

// =========================
// 공통 유틸
// =========================
function minusOneDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

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

function toChecklistMarkdown(raw = "") {
  if (!raw.trim()) return "";

  const lines = raw
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, ""));

  if (lines.length === 0) return "";

  return lines.map(line => `- [ ] ${line}`).join("\n");
}

// =========================
// 1000.school API
// =========================

// 현재 스니펫 business date 조회
async function getBusinessDate() {
  const res = await fetch(`${SNIPPET_API_BASE_URL}/snippet_date`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${SNIPPET_API_TOKEN}`,
      Accept: "application/json",
    },
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`snippet_date 조회 실패: ${res.status} / ${text}`);
  }

  // 응답이 plain text거나 JSON string일 수 있어서 둘 다 처리
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") return parsed;
    if (parsed?.date) return parsed.date;
  } catch (_) {}

  return text.replace(/"/g, "").trim();
}

// 스니펫 생성
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

  // 문서 예시상 id가 있으므로 우선 id 사용
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

// AI 피드백 조회
async function getDailySnippetFeedback() {
  const res = await fetch(`${SNIPPET_API_BASE_URL}/daily-snippets/feedback`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${SNIPPET_API_TOKEN}`,
      Accept: "application/json",
    },
  });

  const text = await res.text();

  console.log("=== feedback 상태 ===", res.status);
  console.log("=== feedback 원문 응답 ===", text);

  if (!res.ok) {
    throw new Error(`feedback 조회 실패: ${res.status} / ${text}`);
  }

  const data = JSON.parse(text);

  console.log("=== feedback 응답 JSON ===");
  console.log(JSON.stringify(data, null, 2));

  return data;
}

// 스니펫 수정
async function updateDailySnippet(snippetId, content) {
  const res = await fetch(`${SNIPPET_API_BASE_URL}/daily-snippets/${snippetId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${SNIPPET_API_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ content }),
  });

  const text = await res.text();

  console.log("=== PUT 상태 ===", res.status);
  console.log("=== PUT 원문 응답 ===", text);

  if (!res.ok) {
    throw new Error(`daily-snippets PUT 실패: ${res.status} / ${text}`);
  }
}

// =========================
// Notion API
// =========================

// 공통 Notion query
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

// 현재 business date에 해당하는, 아직 전송 안 된 오늘 행 찾기
async function getPendingRowsForBusinessDate(businessDate) {
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
      {
        property: "기록일자",
        date: { equals: businessDate },
      },
    ],
  });
}

// 특정 날짜의 노션 행 1개 가져오기
async function getRowByDate(dateStr) {
  const rows = await queryNotion({
    property: "기록일자",
    date: { equals: dateStr },
  });
  return rows[0] || null;
}

// 전송 후 노션 업데이트
async function updateNotionAfterSend(pageId, { snippetId, feedback }) {
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

  if (feedback) {
    body.properties["AI피드백"] = {
      rich_text: [{ text: { content: feedback.slice(0, 1900) } }],
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

// =========================
// 콘텐츠 조립
// =========================

// 1차 저장용: 체크리스트 + 원문
function buildInitialContent({ title, author, team, rawBody, yesterdayTodoChecklist, businessDate }) {
  const todoSection = yesterdayTodoChecklist
    ? `## 전날 내일 할 일 체크리스트\n${yesterdayTodoChecklist}\n`
    : `## 전날 내일 할 일 체크리스트\n- [ ] 전날 기록이 없어 체크리스트를 불러오지 못했습니다.\n`;

  return [
    `<!-- business-date: ${businessDate} -->`,
    `## 제목`,
    `${title}`,
    ``,
    `작성자: ${author || "-"}`,
    `팀: ${team || "-"}`,
    ``,
    todoSection,
    `## 원문 기록`,
    rawBody || "(내용 없음)",
  ].join("\n");
}

// 최종 업데이트용: 체크리스트 + AI 요약
function buildFinalContent({ title, author, team, yesterdayTodoChecklist, feedback, businessDate }) {
  const todoSection = yesterdayTodoChecklist
    ? `## 전날 내일 할 일 체크리스트\n${yesterdayTodoChecklist}\n`
    : `## 전날 내일 할 일 체크리스트\n- [ ] 전날 기록이 없어 체크리스트를 불러오지 못했습니다.\n`;

  return [
    `<!-- business-date: ${businessDate} -->`,
    `## 제목`,
    `${title}`,
    ``,
    `작성자: ${author || "-"}`,
    `팀: ${team || "-"}`,
    ``,
    todoSection,
    `## AI 요약 및 정리`,
    feedback || "AI 피드백을 가져오지 못했습니다.",
  ].join("\n");
}

// =========================
// 메인 실행
// =========================
async function main() {
  // 1. 서버 기준 현재 스니펫 날짜 확인
  const businessDate = await getBusinessDate();
  console.log("현재 스니펫 business date:", businessDate);

  // 2. 오늘(서버 기준) 전송 대상 찾기
  const pendingRows = await getPendingRowsForBusinessDate(businessDate);
  console.log("전송 대상 개수:", pendingRows.length);

  if (pendingRows.length === 0) {
    console.log("전송할 항목이 없습니다.");
    return;
  }

  // 3. 전날 행에서 '내일할일' 가져오기
  const prevDate = minusOneDay(businessDate);
  const prevRow = await getRowByDate(prevDate);

  const yesterdayTodoRaw = prevRow ? getRichText(prevRow.properties["내일할일"]) : "";
  const yesterdayTodoChecklist = toChecklistMarkdown(yesterdayTodoRaw);

  // 4. 각 대상 행 처리
  for (const row of pendingRows) {
    const props = row.properties;

    const title = getTitle(props["제목"]);
    const rawBody = getRichText(props["내용"]);
    const author = getAuthor(props);
    const team = getRichText(props["팀명"]);

    // 4-1. 초안 생성 (체크리스트 + 원문)
    const initialContent = buildInitialContent({
      title,
      author,
      team,
      rawBody,
      yesterdayTodoChecklist,
      businessDate,
    });

    console.log("=== 초기 전송 content ===");
    console.log(initialContent);

    // 4-2. POST
    const { snippetId } = await createDailySnippet(initialContent);

    // 4-3. AI feedback 조회
    const feedbackRes = await getDailySnippetFeedback();
    const feedback = feedbackRes?.feedback || "";

    // 4-4. snippetId가 있으면 최종 업데이트
    if (snippetId) {
      const finalContent = buildFinalContent({
        title,
        author,
        team,
        yesterdayTodoChecklist,
        feedback,
        businessDate,
      });

      console.log("=== 최종 업데이트 content ===");
      console.log(finalContent);

      await updateDailySnippet(snippetId, finalContent);
    } else {
      console.warn("snippetId를 찾지 못해서 PUT 업데이트는 건너뜁니다.");
    }

    // 4-5. 노션 업데이트
    await updateNotionAfterSend(row.id, {
      snippetId,
      feedback,
    });
  }
}

main().catch((err) => {
  console.error("실행 중 오류:", err);
  process.exit(1);
});
