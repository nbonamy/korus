import { expect, it } from 'vitest';
import { annotationFromBrowserOwner, annotationToBrowserOwner, viewportFromBrowserOwner, viewportToBrowserOwner } from '../browser-contracts';

it('keeps released browser wire identities while adapting neutral SDK owner identities', () => {
  const annotation = { id: 'annotation', agentId: 'agent', browserId: 'secondary', url: 'https://example.com', kind: 'area' as const, comment: 'Keep this', rect: { x: 1, y: 2, width: 3, height: 4 } };
  const viewport = { agentId: 'agent', browserId: 'secondary', requestId: 'request', viewport: { preset: 'phone' as const } };
  const original = structuredClone({ annotation, viewport });
  const { agentId: annotationAgent, ...annotationData } = annotation;
  const { agentId: viewportAgent, ...viewportData } = viewport;
  expect(annotationToBrowserOwner(annotation)).toStrictEqual({ ...annotationData, ownerId: annotationAgent });
  expect(viewportToBrowserOwner(viewport)).toStrictEqual({ ...viewportData, ownerId: viewportAgent });
  expect(annotationFromBrowserOwner(annotationToBrowserOwner(annotation))).toStrictEqual(annotation);
  expect(viewportFromBrowserOwner(viewportToBrowserOwner(viewport))).toStrictEqual(viewport);
  expect({ annotation, viewport }).toStrictEqual(original);
});
