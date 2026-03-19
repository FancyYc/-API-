const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const SNIPPET_API_URL = process.env.SNIPPET_API_URL;
const SNIPPET_API_TOKEN = process.env.SNIPPET_API_TOKEN;

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

  console.log("=== Notion 응답 전체 ===");
  console.log(JSON.stringify(data, null, 2));

  if (!res.ok) {
    throw new Error(`Notion API 요청 실패: ${res.status} / ${JSON.stringify(data)}`);
  }

  if (!data.results) {
    throw new Error(`Notion 응답에 results가 없음: ${JSON.stringify(data)}`);
  }

  return data.results;
}

function getTitle(prop) {
  return prop?.title?.[0]?.plain_text || "";
}

function getRichText(prop) {
  return prop?.rich_text?.map((t) => t.plain_text).join("") || "";
}

function getStatus(prop) {
  return prop?.status?.name || "";
}

async function sendToSnippetAPI(item) {
  const props = item.properties;

  const payload = {
    title: getTitle(props["제목"]),
    content: getRichText(props["내용"]),
    author: getRichText(props["작성자"]),
    team: getRichText(props["팀명"]),
  };

  console.log("=== 1000.school로 보낼 payload ===");
  console.log(JSON.stringify(payload, null, 2));

  const res = await fetch(SNIPPET_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SNIPPET_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.text();

  console.log("=== 1000.school 응답 상태 ===", res.status);
  console.log("=== 1000.school 응답 본문 ===", data);

  if (!res.ok) {
    throw new Error(`Snippet API 요청 실패: ${res.status} / ${data}`);
  }
}

async function main() {
  const items = await getNotionData();

  console.log("가져온 데이터 개수:", items.length);

  if (items.length === 0) {
    console.log("전송할 노션 데이터가 없습니다.");
    return;
  }

  for (const item of items) {
    await sendToSnippetAPI(item);
  }
}

main().catch((err) => {
  console.error("실행 중 오류:", err);
  process.exit(1);
});
