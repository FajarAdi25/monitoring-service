import type { Request, Response } from "express";

export class TelegramDummyWebhookController {
  receive = async (req: Request, res: Response): Promise<void> => {
    console.log(`[TELEGRAM:DUMMY_WEBHOOK] ${JSON.stringify(req.body)}`);
    res.status(202).json({
      success: true,
      data: {
        accepted: true,
        receivedAt: new Date().toISOString()
      }
    });
  };
}
