import fetch from "node-fetch";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const SNIPPET_API_URL = process.env.SNIPPET_API_URL;
const SNIPPET_API_TOKEN = process.env.SNIPPET_API_TOKEN;

// 노션 DB 조회
async function getNotionData() {
  const res = await fetch(`https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      filter: {
        and: [
          {
            property: "상태",
            select: { equals: "완료" }
          },
          {
            property: "전송완료",
            checkbox: { equals: false }
          }
        ]
      }
    })
  });

  const data = await res.json();
  return data.results;
}

// 노션 값 꺼내기
function getText(prop) {
  return prop?.rich_text?.[0]?.plain_text || "";
}

// API 전송
async function sendToAPI(item) {
  const props = item.properties;

  const payload = {
    title: props.제목.title[0].plain_text,
    content: getText(props.내용),
    author: getText(props.작성자),
    team: getText(props.팀명)
  };

  console.log("보내는 데이터:", payload);

  const res = await fetch(SNIPPET_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SNIPPET_API_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  console.log("응답 상태:", res.status);
}

// 실행
async function main() {
  const items = await getNotionData();

  console.log("가져온 데이터 개수:", items.length);

  for (const item of items) {
    await sendToAPI(item);
  }
}

main();
