import { DataSource } from "typeorm";
import { Provider } from '../base';
import { ChatOpenaiInputParamsSchema } from '../../schema/providerSchemas/chatOpenai.schema';
import { validateData } from '../../utils/schemaValidator';
import { GenerationResponseSchema } from '../../schema'
import { SSE_EVENTS } from "../../constants";
import generateResponse from "./generate";
import getTokenUsage from "./tokenUsage";
import checkOpenaiHealth from "./healthCheck";


export class ChatOpenAIProvider extends Provider<ChatOpenaiInputParamsSchema> {

  protected validateParams(params: any): ChatOpenaiInputParamsSchema {
    return validateData<ChatOpenaiInputParamsSchema>(ChatOpenaiInputParamsSchema, params);
  }

  protected async performGeneration(params: ChatOpenaiInputParamsSchema, timeout: number, maxRetries: number): Promise<GenerationResponseSchema> {
    const response = await generateResponse({ params: params, stream: false, isAzure: false, timeout, maxRetries });
    return {
      id: response?.id,
      choices: response?.choices?.map((choice: Record<string, any>) => {
        return {
          text: choice?.message?.content,
          index: choice?.index,
          finish_reason: choice?.finish_reason,
          role: choice?.message?.role,
          function_call: choice?.message?.function_call,
        }
      }
      ),
      model: response?.model,
      meta: {
        usage: response?.usage,
      }
    }
  }

  protected async *performStreamGeneration(params: ChatOpenaiInputParamsSchema, timeout: number, maxRetries: number): AsyncGenerator<any> {
    const response = await generateResponse({ params: params, stream: true, isAzure: false, timeout, maxRetries });
    let texts = ""
    for await (const message of response) {
      const text = message?.choices?.[0]?.delta?.content || "";
      const finishReason = message?.choices?.[0]?.finish_reason;
      const tool_calls = message?.choices?.[0]?.delta?.tool_calls;
      texts += text;
      yield {
        id: message?.id,
        event: SSE_EVENTS.UPDATE,
        data: {
          text: text,
          finish_reason: finishReason,
          tool_calls: tool_calls,
        }
      };
    }
    yield {
      event: SSE_EVENTS.META,
      data: {
        text: texts,
        model: params.model,
        usage: await this.tokenUsage(params, texts)
      }
    }
  }

  public async tokenUsage(params: ChatOpenaiInputParamsSchema, completionText: string): Promise<any> {
    return getTokenUsage(params.messages, completionText, params.model);
  }

  public async healthCheck(orm: DataSource): Promise<boolean> {
    return checkOpenaiHealth(orm);
  }
}
