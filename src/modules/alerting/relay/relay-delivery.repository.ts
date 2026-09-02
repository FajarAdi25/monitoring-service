import { DataSource, Repository } from "typeorm";
import { RelayDeliveryEntity } from "./relay-delivery.entity";

export class RelayDeliveryRepository {
  private readonly repository: Repository<RelayDeliveryEntity>;
  constructor(dataSource: DataSource) { this.repository = dataSource.getRepository(RelayDeliveryEntity); }

  create(data: Partial<RelayDeliveryEntity>) { return this.repository.create(data); }
  save(entity: RelayDeliveryEntity) { return this.repository.save(entity); }
  findPending(limit = 100) {
    return this.repository.createQueryBuilder("d")
      .where("d.status IN (:...status)", { status: ["PENDING", "FAILED"] })
      .andWhere("d.next_retry_at IS NULL OR d.next_retry_at <= NOW()")
      .orderBy("d.id", "ASC").limit(limit).getMany();
  }
  async cancelOpen(incidentId: string) {
    await this.repository.update({ incidentId, eventType: "OPEN", status: "PENDING" }, { status: "CANCELLED" });
  }
}
