const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const SNIPPET_API_URL = process.env.SNIPPET_API_URL;
const SNIPPET_API_TOKEN = process.env.SNIPPET_API_TOKEN;

// =======================
// Notion 데이터 가져오기
// =======================
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

  if (!res.ok) {
    throw new Error(`Notion API 실패: ${res.status}`);
  }

  return data.results;
}

// =======================
// 데이터 파싱
// =======================
function getTitle(prop) {
  return prop?.title?.[0]?.plain_text || "";
}

function getRichText(prop) {
  return prop?.rich_text?.map((t) => t.plain_text).join("") || "";
}

function getPeopleNames(prop) {
  return prop?.people?.map((p) => p.name).join(", ") || "";
}

// =======================
// Snippet API 전송
// =======================
async function sendToSnippetAPI(content) {
  const res = await fetch(SNIPPET_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SNIPPET_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content,
    }),
  });

  const text = await res.text();

  console.log("응답 상태:", res.status);
  console.log("응답 내용:", text);

  if (!res.ok) {
    throw new Error("Snippet API 전송 실패");
  }
}

// =======================
// 전송 완료 체크
// =======================
async function markAsSent(pageId) {
  await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
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
}

// =======================
// 메인 로직
// =======================
async function main() {
  const items = await getNotionData();

  console.log("가져온 개수:", items.length);

  for (const item of items) {
    const props = item.properties;

    const title = getTitle(props["제목"]);
    const content = getRichText(props["내용"]);
    const author =
      getRichText(props["작성자"]) || getPeopleNames(props["작성자"]);
    const team = getRichText(props["팀명"]);

    // 👉 마크다운 직접 구성
    const finalContent = `
## ${title}

작성자: ${author}
팀: ${team}

---

${content}
`;

    console.log("전송 데이터:", finalContent);

    await sendToSnippetAPI(finalContent);
    await markAsSent(item.id);
  }
}

main().catch((err) => {
  console.error("에러:", err);
  process.exit(1);
});
