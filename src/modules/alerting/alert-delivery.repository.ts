// Version: 2.7.1
import type { DataSource, DeepPartial, Repository } from "typeorm";
import { AlertDeliveryEntity } from "./alert-delivery.entity";

export interface AlertDeliveryRepositoryPort {
  create(input: DeepPartial<AlertDeliveryEntity>): AlertDeliveryEntity;
  save(delivery: AlertDeliveryEntity): Promise<AlertDeliveryEntity>;
  findDue(now: Date, limit: number): Promise<AlertDeliveryEntity[]>;
}

export class AlertDeliveryRepository implements AlertDeliveryRepositoryPort {
  private readonly repository: Repository<AlertDeliveryEntity>;

  constructor(dataSource: DataSource) {
    this.repository = dataSource.getRepository(AlertDeliveryEntity);
  }

  create(input: DeepPartial<AlertDeliveryEntity>): AlertDeliveryEntity {
    return this.repository.create(input);
  }

  save(delivery: AlertDeliveryEntity): Promise<AlertDeliveryEntity> {
    return this.repository.save(delivery);
  }

  findDue(now: Date, limit: number): Promise<AlertDeliveryEntity[]> {
    return this.repository.createQueryBuilder("delivery")
      .where("delivery.status = :status", { status: "PENDING" })
      .andWhere("delivery.next_attempt_at <= :now", { now })
      .orderBy("delivery.id", "ASC")
      .take(limit)
      .getMany();
  }
}
