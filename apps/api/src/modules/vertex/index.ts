import { createStubModule } from '../module-utils.js';

export const vertexModule = createStubModule(
  'vertex',
  'Vertex provider is configured through ADC and service identity, but live invocation depends on local ADC or Cloud Run IAM.',
  'ok'
);
