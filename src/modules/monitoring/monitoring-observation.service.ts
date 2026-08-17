import type { DataSource } from "typeorm";
import { MonitoringCurrentStateEntity } from "./monitoring-current-state.entity";
import { MonitoringSnapshotEntity } from "./monitoring-snapshot.entity";
import type { SaveMonitoringSnapshotInput } from "./monitoring-snapshot.types";

export class MonitoringObservationService {
  constructor(private readonly dataSource: DataSource) {}

  async record(input: SaveMonitoringSnapshotInput): Promise<{ changed: boolean }> {
    const observedAt = input.observedAt ?? new Date();

    return this.dataSource.transaction(async manager => {
      const currentRepository = manager.getRepository(MonitoringCurrentStateEntity);
      const snapshotRepository = manager.getRepository(MonitoringSnapshotEntity);

      const current = await currentRepository.findOne({
        where: {
          clusterId: input.clusterId,
          source: input.source,
          resourceType: input.resourceType,
          resourceKey: input.resourceKey
        }
      });

      const changed = current === null || current.state !== input.state;

      if (current === null) {
        await currentRepository.save(currentRepository.create({
          clusterId: input.clusterId,
          source: input.source,
          resourceType: input.resourceType,
          resourceKey: input.resourceKey,
          resourceName: input.resourceName ?? null,
          state: input.state,
          payloadJson: input.payload ?? null,
          lastCheckedAt: observedAt,
          lastChangedAt: observedAt
        }));
      } else {
        current.resourceName = input.resourceName ?? current.resourceName;
        current.state = input.state;
        current.payloadJson = input.payload ?? null;
        current.lastCheckedAt = observedAt;
        if (changed) current.lastChangedAt = observedAt;
        await currentRepository.save(current);
      }

      if (changed) {
        await snapshotRepository.save(snapshotRepository.create({
          clusterId: input.clusterId,
          source: input.source,
          resourceType: input.resourceType,
          resourceKey: input.resourceKey,
          resourceName: input.resourceName ?? null,
          state: input.state,
          payloadJson: input.payload ?? null,
          observedAt
        }));
      }

      return { changed };
    });
  }

  async latestStates(input: {
    clusterId: string;
    source: string;
    resourceType: string;
  }): Promise<Array<{ resourceKey: string; state: string }>> {
    const repository = this.dataSource.getRepository(MonitoringCurrentStateEntity);
    const rows = await repository.find({
      where: {
        clusterId: input.clusterId,
        source: input.source,
        resourceType: input.resourceType
      },
      select: {
        resourceKey: true,
        state: true
      }
    });

    return rows.map(row => ({ resourceKey: row.resourceKey, state: row.state }));
  }
}
