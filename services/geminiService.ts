
import { GoogleGenAI } from "@google/genai";

/**
 * 구글 Gemini API를 직접 사용하여 학생 기록을 전문적인 문체로 다듬습니다.
 * 시스템 환경 변수(process.env.API_KEY)를 사용하므로 보안이 강화됩니다.
 */
export const polishRecord = async (
  rawText: string,
  onStatusUpdate?: (status: string) => void
): Promise<string> => {
  // 보안 지침에 따라 API_KEY는 process.env에서 직접 가져옵니다.
  const apiKey = process.env.API_KEY;
  
  if (!apiKey) {
    return "시스템 설정에서 API_KEY가 구성되지 않았습니다. 관리자에게 문의하세요.";
  }

  // 최신 GoogleGenAI 인스턴스 생성
  const ai = new GoogleGenAI({ apiKey });

  try {
    if (onStatusUpdate) {
      onStatusUpdate("Gemini AI가 문장을 다듬는 중...");
    }

    // gemini-3-flash-preview 모델을 사용하여 빠르고 정확하게 변환
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{
        role: 'user',
        parts: [{
          text: `당신은 대한민국 고등학교 교사입니다. 다음의 학생 활동 메모를 학교생활기록부(생기부) 기재 요령에 맞게 전문적인 문체로 다듬어주세요.

문체 가이드:
- '~함', '~임', '~함.' 형태의 명조체 종결 어미를 사용하세요.
- 주어(학생 이름)는 문맥상 필요한 경우에만 최소한으로 사용하고 가급적 생략하세요.
- 구체적인 행동과 변화, 성취 위주로 기술하세요.
- 결과물만 출력하고 부연 설명은 하지 마세요.

메모: ${rawText}`
        }]
      }],
      config: {
        temperature: 0.1, // 창의성보다 정확성을 위해 낮게 설정
        topP: 0.95,
      },
    });

    const result = response.text;
    
    if (!result) {
      throw new Error("AI 응답 생성 실패");
    }
    
    return result.trim();

  } catch (error: any) {
    console.error("Gemini Direct API Error:", error);
    
    if (error.message?.includes("403")) {
      return "API 키 권한 오류입니다. 키가 활성화되어 있는지 확인해주세요.";
    }
    if (error.message?.includes("429")) {
      return "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.";
    }
    
    return `AI 변환 중 오류가 발생했습니다. (사유: ${error.message || "네트워크 상태 확인 요망"})`;
  }
};
