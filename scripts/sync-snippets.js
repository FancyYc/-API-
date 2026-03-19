const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const SNIPPET_API_URL = process.env.SNIPPET_API_URL;
const SNIPPET_API_TOKEN = process.env.SNIPPET_API_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function getNotionData() {
  const res = await fetch(
    `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filter: {
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
        },
      }),
    }
  );

  const data = await res.json();

  console.log("=== Notion 응답 ===");
  console.log(JSON.stringify(data, null, 2));

  if (!res.ok) {
    throw new Error(`Notion API 실패: ${res.status} / ${JSON.stringify(data)}`);
  }

  if (!data.results) {
    throw new Error(`Notion results 없음: ${JSON.stringify(data)}`);
  }

  return data.results;
}

function getTitle(prop) {
  return prop?.title?.[0]?.plain_text || "";
}

function getRichText(prop) {
  return prop?.rich_text?.map((t) => t.plain_text).join("") || "";
}

function getPeopleNames(prop) {
  return prop?.people?.map((p) => p.name).join(", ") || "";
}

async function rewriteWithAI(rawText, meta = {}) {
  const prompt = `
너는 팀 일간 스니펫 편집기다.
아래 원문 메모를 읽고, 핵심 키워드와 주요 내용을 뽑아
반드시 "마크다운 형식"으로 정리된 스니펫을 만들어라.

요구사항:
- 출력은 반드시 마크다운만 출력
- 불필요한 장황한 설명 금지
- 문장은 간결하게 정리
- 실제 원문에 없는 내용은 지어내지 말 것
- bullet은 "-"로 통일
- 아래 섹션 순서를 유지할 것

섹션 형식:
## 오늘 한 일
## 수행 목적
## 하이라이트
## 로우라이트
## 내일의 우선순위
## 오늘 내가 팀에 기여한 가치
## 오늘의 배움 또는 남길 말
## 핵심 키워드

메타정보:
- 제목: ${meta.title || ""}
- 작성자: ${meta.author || ""}
- 팀명: ${meta.team || ""}

원문:
${rawText}
`;

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5-mini",
      input: prompt,
    }),
  });

  const data = await res.json();

  console.log("=== OpenAI 응답 ===");
  console.log(JSON.stringify(data, null, 2));

  if (!res.ok) {
    throw new Error(`OpenAI API 실패: ${res.status} / ${JSON.stringify(data)}`);
  }

  // Responses API 텍스트 추출
  const outputText =
    data.output_text ||
    data.output?.map(item =>
      item.content?.map(c => c.text).join("")
    ).join("\n") ||
    "";

  if (!outputText.trim()) {
    throw new Error("OpenAI가 빈 응답을 반환함");
  }

  return outputText.trim();
}

async function sendToSnippetAPI(content) {
  const payload = { content };

  const res = await fetch(SNIPPET_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SNIPPET_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.text();

  console.log("=== Snippet API 응답 상태 ===", res.status);
  console.log("=== Snippet API 응답 본문 ===", data);

  if (!res.ok) {
    throw new Error(`Snippet API 실패: ${res.status} / ${data}`);
  }
}

async function markAsSent(pageId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: {
        전송완료: {
          checkbox: true,
        },
      },
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Notion 업데이트 실패: ${res.status} / ${JSON.stringify(data)}`);
  }
}

async function main() {
  const items = await getNotionData();
  console.log("가져온 데이터 개수:", items.length);

  if (items.length === 0) {
    console.log("전송할 데이터 없음");
    return;
  }

  for (const item of items) {
    const props = item.properties;

    const rawBody = getRichText(props["내용"]);
    const title = getTitle(props["제목"]);
    const author =
      getRichText(props["작성자"]) || getPeopleNames(props["작성자"]);
    const team = getRichText(props["팀명"]);

    const finalMarkdown = await rewriteWithAI(rawBody, {
      title,
      author,
      team,
    });

    console.log("=== 최종 마크다운 ===");
    console.log(finalMarkdown);

    await sendToSnippetAPI(finalMarkdown);
    await markAsSent(item.id);
  }
}

main().catch((err) => {
  console.error("실행 중 오류:", err);
  process.exit(1);
});
