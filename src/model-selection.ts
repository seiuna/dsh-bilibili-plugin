export interface ModelSelection { provider: string; model: string; reasoningEffort?: string }
export interface ModelIdentity { id: string; name?: string }
export interface ModelInfo {
  reasoning?: {
    efforts?: Array<ModelIdentity & { description?: string }>;
    defaultEffort?: string;
  };
}
/** Public host operations only; model credentials never enter catalog responses. */
export interface ModelService {
  listProviders(): Promise<ModelIdentity[]>;
  listModels(provider: string): Promise<ModelIdentity[]>;
  resolveModelInfo?(provider: string, model: string): Promise<ModelInfo | undefined>;
}
export class ModelSelectionError extends Error {
  constructor(public readonly kind: 'unavailable' | 'invalid', message: string) { super(message); }
}

function selectionText(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) {
    throw new ModelSelectionError('invalid', `${name} 必须是长度有效的非空字符串`);
  }
  return value.trim();
}

/** Await the real host's asynchronous provider catalog and tolerate per-provider metadata failures. */
export async function modelCatalog(llm?: ModelService) {
  if (!llm) throw new ModelSelectionError('unavailable', '模型服务未就绪');
  const providers = await llm.listProviders();
  return Promise.all(providers.map(async provider => {
    try {
      const models = await llm.listModels(provider.id);
      const detailedModels = await Promise.all(models.map(async model => {
        let reasoning;
        try {
          const info = await llm.resolveModelInfo?.(provider.id, model.id);
          if (info?.reasoning?.efforts?.length) {
            reasoning = {
              efforts: info.reasoning.efforts.map(effort => ({
                id: effort.id, name: effort.name ?? effort.id, description: effort.description,
              })),
              defaultEffort: info.reasoning.defaultEffort,
            };
          }
        } catch { /* Optional metadata failures must not hide an otherwise selectable model. */ }
        return { id: model.id, name: model.name || model.id, reasoning };
      }));
      return { id: provider.id, name: provider.name || provider.id, models: detailedModels };
    } catch {
      return { id: provider.id, name: provider.name || provider.id, models: [], error: '获取模型失败' };
    }
  }));
}

/** Fail closed for explicit invalid selections; never silently discard requested reasoning effort. */
export async function validateModelSelection(llm: ModelService | undefined, value: unknown): Promise<ModelSelection | null> {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new ModelSelectionError('invalid', 'modelSelection 必须是对象');
  const selection = value as Record<string, unknown>;
  const provider = selectionText(selection.provider, 'provider', 256);
  const model = selectionText(selection.model, 'model', 512);
  const reasoningEffort = selection.reasoningEffort === undefined
    ? undefined : selectionText(selection.reasoningEffort, 'reasoningEffort', 128);
  if (!llm) throw new ModelSelectionError('unavailable', '模型服务未就绪');
  const providers = await llm.listProviders();
  if (!providers.some(item => item.id === provider)) throw new ModelSelectionError('invalid', '找不到所选提供商');
  const models = await llm.listModels(provider);
  if (!models.some(item => item.id === model)) throw new ModelSelectionError('invalid', '该提供商下找不到所选模型');
  if (reasoningEffort !== undefined) {
    if (!llm.resolveModelInfo) throw new ModelSelectionError('invalid', '当前模型服务无法验证思考强度');
    const info = await llm.resolveModelInfo(provider, model);
    if (!info?.reasoning?.efforts?.some(effort => effort.id === reasoningEffort)) {
      throw new ModelSelectionError('invalid', '所选模型不支持该思考强度');
    }
  }
  return { provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) };
}
