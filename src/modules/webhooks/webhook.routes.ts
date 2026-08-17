import { Router } from "express";
import { asyncHandler } from "../../common/middleware/async-handler";
import { TelegramDummyWebhookController } from "./telegram-dummy.controller";

export function createWebhookRouter(controller: TelegramDummyWebhookController): Router {
  const router = Router();
  router.post("/telegram/dummy", asyncHandler(controller.receive));
  return router;
}
