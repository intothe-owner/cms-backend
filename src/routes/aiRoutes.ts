import { Router, Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';

const router = Router();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

router.post('/generate-page', async (req: Request, res: Response) => {
  try {
    const { prompt } = req.body;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        // AI가 무조건 JSON 형태로 응답하도록 강제합니다.
        responseMimeType: "application/json",
        systemInstruction: `당신은 웹 페이지 빌더 도우미입니다.
        사용자의 요청을 분석하여 텍스트, 이미지, 비디오 요소를 분리하여 아래 JSON 배열 형식으로만 응답하세요.
        
        [규칙]
        1. 일반적인 레이아웃이나 설명은 "TEXT" 타입에 HTML로 작성하세요.
        2. 이미지나 동영상이 들어가야 할 자리는 HTML <img> 태그를 쓰지 말고, "IMAGE" 또는 "VIDEO" 타입의 객체를 별도로 배열에 추가하세요.
        
        [출력 예시]
        [
          { "type": "TEXT", "content": "<h2>회사 소개</h2><p>저희 회사는...</p>" },
          { "type": "IMAGE", "content": "" },
          { "type": "TEXT", "content": "<h3>홍보 영상</h3>" },
          { "type": "VIDEO", "content": "" }
        ]`
      }
    });

    // AI가 반환한 JSON 문자열을 파싱합니다.
    const elementsData = JSON.parse(response.text || "[]");
    res.status(200).json({ success: true, elements: elementsData });
  } catch (error) {
    console.error("Gemini API 호출 실패:", error);
    res.status(500).json({ success: false, message: "AI 생성 실패" });
  }
});

export default router;