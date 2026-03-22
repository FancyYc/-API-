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

function normalizeText(text = "") {
  return text
    .toLowerCase()
    .replace(/[^\w가-힣\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLines(raw = "") {
  return raw
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, ""));
}

function extractKeywords(line = "") {
  const normalized = normalizeText(line);

  const stopwords = new Set([
    "하기", "하기를", "이상", "정도", "관련", "통해", "및", "그리고",
    "오늘", "내일", "한", "할", "수", "것", "등", "더", "잘",
    "했다", "함", "했다는", "위해", "에서", "으로", "에게"
  ]);

  return normalized
    .split(" ")
    .map(w => w.trim())
    .filter(w => w.length >= 2 && !stopwords.has(w));
}

// ---------- 마크다운 섹션 생성 ----------
function buildBulletSection(title, raw = "") {
  const lines = parseLines(raw);
  if (lines.length === 0) return "";

  return [
    `## ${title}`,
    ...lines.map(line => `- ${line}`),
    ""
  ].join("\n");
}

function buildCheckboxSection(title, raw = "") {
  const lines = parseLines(raw);
  if (lines.length === 0) return "";

  return [
    `## ${title}`,
    ...lines.map(line => `- [ ] ${line}`),
    ""
  ].join("\n");
}

function buildTodayWorkSection(raw = "", goalCompletionText = "") {
  const lines = parseLines(raw);

  const sectionLines = [`## 오늘 한 일`];

  if (lines.length === 0) {
    sectionLines.push(`- (내용 없음)`);
  } else {
    sectionLines.push(...lines.map(line => `- ${line}`));
  }

  if (goalCompletionText) {
    sectionLines.push("");
    sectionLines.push(`**${goalCompletionText}**`);
  }

  sectionLines.push("");
  return sectionLines.join("\n");
}

function buildAnomalySection(messages = []) {
  if (!messages.length) return "";

  return [
    `## 이상 패턴 감지`,
    ...messages.map(msg => `- ${msg}`),
    ""
  ].join("\n");
}

// ---------- 목표 달성률 계산 ----------
function calculateGoalCompletion(yesterdayGoalsRaw = "", todayWorkRaw = "") {
  const goals = parseLines(yesterdayGoalsRaw);
  const todayText = normalizeText(todayWorkRaw);

  if (goals.length === 0) {
    return {
      percent: null,
      doneCount: 0,
      totalCount: 0,
      details: [],
      summaryText: "어제 설정한 목표가 없습니다."
    };
  }

  const details = goals.map(goal => {
    const keywords = extractKeywords(goal);
    const matched = keywords.some(keyword => todayText.includes(keyword));

    return {
      goal,
      matched
    };
  });

  const doneCount = details.filter(d => d.matched).length;
  const totalCount = details.length;
  const percent = Math.round((doneCount / totalCount) * 100);

  return {
    percent,
    doneCount,
    totalCount,
    details,
    summaryText: `어제 목표 달성률: ${percent}% (${doneCount}/${totalCount})`
  };
}

// ---------- 이상 패턴 감지 ----------
function detectAnomalies({
  todayWorkRaw = "",
  purposeRaw = "",
  highlightRaw = "",
  lowlightRaw = "",
  tomorrowRaw = "",
  teamValueRaw = "",
  learningRaw = ""
}) {
  const messages = [];

  const todayCount = parseLines(todayWorkRaw).length;
  const purposeCount = parseLines(purposeRaw).length;
  const highlightCount = parseLines(highlightRaw).length;
  const lowlightCount = parseLines(lowlightRaw).length;
  const tomorrowCount = parseLines(tomorrowRaw).length;
  const teamValueCount = parseLines(teamValueRaw).length;
  const learningCount = parseLines(learningRaw).length;

  if (todayCount <= 2) {
    messages.push("오늘 한 일의 항목 수가 적습니다. 행동 단위를 더 잘게 나눠 3개 이상 기록해보세요.");
  }

  if (purposeCount === 0) {
    messages.push("수행 목적이 비어 있습니다. 왜 이 일을 했는지 한 줄이라도 적으면 회고의 방향성이 더 분명해집니다.");
  }

  if (lowlightCount > highlightCount && lowlightCount > 0) {
    messages.push("로우라이트가 하이라이트보다 더 많습니다. 계획을 객관적이고 철저하게 세워서 지킬 수 있는 것들만 써주세요.");
  }

  if (tomorrowCount === 0) {
    messages.push("내일 할일이 비어 있습니다. 다음 행동 계획이 없으면 회고가 실행으로 이어지기 어렵습니다.");
  }

  if (teamValueCount === 0) {
    messages.push("오늘 내가 팀에 기여한 가치가 비어 있습니다. 개인 작업이 팀에 어떤 영향을 줬는지 한 줄이라도 적어보세요.");
  }

  if (learningCount === 0) {
    messages.push("오늘의 배움 또는 남길 말이 비어 있습니다. 하루를 통해 얻은 깨달음을 남기면 회고의 깊이가 더 좋아집니다.");
  }

  if (messages.length === 0) {
    messages.push("큰 이상 패턴은 감지되지 않았습니다. 현재 구조를 유지하면서 기록의 밀도를 조금씩 높여가면 좋습니다.");
  }

  return messages;
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

async function getRowByDate(dateStr) {
  const rows = await queryNotion({
    property: "기록일자",
    date: { equals: dateStr },
  });
  return rows[0] || null;
}

// ---------- 스니펫 전송 ----------
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
async function markAsSent(pageId, snippetId = null, anomalyMessages = []) {
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

  if (anomalyMessages.length > 0) {
    body.properties["이상패턴감지"] = {
      rich_text: [
        {
          text: {
            content: anomalyMessages.join("\n").slice(0, 1900)
          }
        }
      ],
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
function buildFinalContent(props, yesterdayGoalsRaw = "") {
  const title = getTitle(props["제목"]);

  const todayWorkRaw = getRichText(props["오늘 한 일"]);
  const purposeRaw = getRichText(props["수행 목적"]);
  const highlightRaw = getRichText(props["하이라이트"]);
  const lowlightRaw = getRichText(props["로우라이트"]);
  const tomorrowRaw = getRichText(props["내일 할일"]);
  const teamValueRaw = getRichText(props["오늘 내가 팀에 기여한 가치"]);
  const learningRaw = getRichText(props["오늘의 배움 또는 남길 말"]);

  const goalCompletion = calculateGoalCompletion(yesterdayGoalsRaw, todayWorkRaw);

  const anomalyMessages = detectAnomalies({
    todayWorkRaw,
    purposeRaw,
    highlightRaw,
    lowlightRaw,
    tomorrowRaw,
    teamValueRaw,
    learningRaw
  });

  const sections = [];

  if (title) {
    sections.push(`## 제목\n${title}\n`);
  }

  sections.push(buildTodayWorkSection(todayWorkRaw, goalCompletion.summaryText));
  sections.push(buildBulletSection("수행 목적", purposeRaw));
  sections.push(buildBulletSection("하이라이트", highlightRaw));
  sections.push(buildBulletSection("로우라이트", lowlightRaw));
  sections.push(buildCheckboxSection("내일 할일", tomorrowRaw));
  sections.push(buildBulletSection("오늘 내가 팀에 기여한 가치", teamValueRaw));
  sections.push(buildBulletSection("오늘의 배움 또는 남길 말", learningRaw));
  sections.push(buildAnomalySection(anomalyMessages));

  return {
    content: sections.filter(Boolean).join("\n").trim(),
    anomalyMessages
  };
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
    const recordDate = props["기록일자"]?.date?.start || "";

    let yesterdayGoalsRaw = "";
    if (recordDate) {
      const prevDate = minusOneDay(recordDate);
      const prevRow = await getRowByDate(prevDate);

      if (prevRow) {
        yesterdayGoalsRaw = getRichText(prevRow.properties["내일 할일"]);
      }
    }

    const { content, anomalyMessages } = buildFinalContent(props, yesterdayGoalsRaw);

    console.log("=== 최종 전송 content ===");
    console.log(content);

    const { snippetId } = await createDailySnippet(content);
    await markAsSent(item.id, snippetId, anomalyMessages);
  }
}

main().catch((err) => {
  console.error("실행 중 오류:", err);
  process.exit(1);
});
