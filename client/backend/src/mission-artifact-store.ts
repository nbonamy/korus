import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { featureStages, type MissionStage } from '@workspace/core/missions';

export type MissionArtifactStorage = {
  read(missionId: string, stage: MissionStage): Promise<string>;
  write(missionId: string, stage: MissionStage, content: string): Promise<{ size: number }>;
};

export class FileMissionArtifactStore implements MissionArtifactStorage {
  constructor(private readonly ensureMissionHome: (missionId: string) => Promise<string>) {}

  async read(missionId: string, stage: MissionStage): Promise<string> {
    return readFile(await this.artifactPath(missionId, stage), 'utf8');
  }

  async write(missionId: string, stage: MissionStage, content: string): Promise<{ size: number }> {
    if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content, 'utf8') > 500_000) {
      throw new Error('Mission artifacts must contain between 1 and 500,000 bytes.');
    }
    const filePath = await this.artifactPath(missionId, stage);
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, content, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, filePath);
    return { size: (await stat(filePath)).size };
  }

  private async artifactPath(missionId: string, stage: MissionStage): Promise<string> {
    if (!/^mission-[a-zA-Z0-9-]+$/.test(missionId) || !featureStages.includes(stage)) {
      throw new Error('Invalid mission artifact path.');
    }
    return path.join(await this.ensureMissionHome(missionId), 'artifacts', `${stage}.md`);
  }
}
