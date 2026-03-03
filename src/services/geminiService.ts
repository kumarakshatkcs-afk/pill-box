import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function identifyPill(base64Image: string) {
  const model = "gemini-3-flash-preview";
  
  const prompt = `
    Analyze this image of a pill. 
    1. Identify the medication name if possible.
    2. Describe its appearance (color, shape, markings).
    3. Provide a confidence level.
    4. Suggest if it matches common medications like 'Aspirin', 'Paracetamol', or 'Vitamin C'.
    
    Return the result in JSON format:
    {
      "name": "Medication Name",
      "description": "Appearance description",
      "confidence": 0.95,
      "match": "Aspirin"
    }
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Image.split(",")[1],
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
      },
    });

    return JSON.parse(response.text || "{}");
  } catch (error) {
    console.error("Error identifying pill:", error);
    return { error: "Failed to identify pill" };
  }
}

export async function getChatResponse(message: string, history: { role: string, parts: { text: string }[] }[]) {
  const model = "gemini-3-flash-preview";
  
  try {
    const chat = ai.chats.create({
      model,
      config: {
        systemInstruction: "You are an AI Medication Assistant for the 'AI Pillbox Prototype'. You help users understand their medication schedule, identify pills, and provide general health advice related to common medications like Aspirin, Paracetamol, and Vitamin C. Be professional, concise, and always remind users to consult a real doctor for medical emergencies.",
      },
    });

    // Note: sendMessage doesn't take history directly in this SDK version's sendMessage call, 
    // but we can initialize the chat with history if needed. 
    // For simplicity in this prototype, we'll just send the message.
    const response = await chat.sendMessage({ message });
    return response.text;
  } catch (error) {
    console.error("Error getting chat response:", error);
    return "I'm sorry, I'm having trouble connecting to my brain right now. Please try again.";
  }
}
