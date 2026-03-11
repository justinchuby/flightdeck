import { z } from 'zod';
import type { ZodType } from 'zod';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Validate `req.body` against a Zod schema. Strips unknown keys via `safeParse`.
 * Uses a generic `any` param type so it doesn't interfere with Express route
 * parameter inference when composed with other handlers.
 */
export function validateBody(schema: ZodType): RequestHandler<any> {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation error',
        details: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    req.body = result.data;
    next();
  };
}

/** Validate `req.params` against a Zod schema. */
export function validateParams(schema: ZodType): RequestHandler<any> {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return res.status(400).json({
        error: 'Invalid parameters',
        details: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Body schemas
// ---------------------------------------------------------------------------

/** POST /api/agents */
export const spawnAgentSchema = z.object({
  roleId: z.string(),
  task: z.string(),
  model: z.string().optional(),
  provider: z.string().optional(),
  mode: z.boolean().optional(),
  autopilot: z.string().optional(),
  sessionId: z.string().optional(),
});

/** Allowed image MIME types (blocks SVG XSS and non-image files) */
const ALLOWED_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

/** Attachment schema for file/image uploads in messages */
export const attachmentSchema = z.object({
  name: z.string().min(1),
  mimeType: z.enum(ALLOWED_IMAGE_MIMES),
  data: z.string().min(1).max(14_000_000),  // base64-encoded, ~10MB binary
});

/** POST /api/agents/:id/message */
export const sendMessageSchema = z.object({
  text: z.string().min(1, 'text is required'),
  mode: z.enum(['queue', 'interrupt']).optional(),
  attachments: z.array(attachmentSchema).max(10).optional(),
});

/** POST /api/lead/:id/message */
export const leadMessageSchema = z.object({
  text: z.string().min(1, 'text is required'),
  mode: z.enum(['queue', 'interrupt']).optional(),
  attachments: z.array(attachmentSchema).max(10).optional(),
});

/** PATCH /api/config — only mutable runtime fields */
export const configPatchSchema = z
  .object({
    maxConcurrentAgents: z.number().int().positive().optional(),
    host: z.string().min(1).optional(),
    oversightLevel: z.enum(['supervised', 'balanced', 'autonomous']).optional(),
    customInstructions: z.string().max(500).optional(),
  })
  .refine(
    (data) =>
      data.maxConcurrentAgents !== undefined ||
      data.host !== undefined ||
      data.oversightLevel !== undefined ||
      data.customInstructions !== undefined,
    {
      message: 'No valid fields to update. Allowed: maxConcurrentAgents, host, oversightLevel, customInstructions',
    },
  );

/** POST /api/lead/:id/dag */
export const dagDeclareSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string(),
      role: z.string(),
      description: z.string().optional(),
      files: z.array(z.string()).optional(),
      dependsOn: z.array(z.string()).optional(),
      priority: z.number().optional(),
      model: z.string().optional(),
    }),
  ),
});

/** Body for dag start action: POST /api/lead/:id/dag/:taskId/start */
export const dagStartSchema = z.object({
  agentId: z.string(),
});

/** POST /api/roles */
export const registerRoleSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'id must be kebab-case'),
  name: z.string().min(1),
  description: z.string().optional().default(''),
  systemPrompt: z.string().optional().default(''),
  color: z.string().optional().default('#888'),
  icon: z.string().optional().default('🤖'),
  model: z.string().optional(),
});

/** POST /api/agents/:id/input */
export const agentInputSchema = z.object({
  text: z.string(),
});

/** POST /api/coordination/locks */
export const acquireLockSchema = z.object({
  agentId: z.string().min(1, 'agentId is required'),
  filePath: z.string().min(1, 'filePath is required').refine(
    (p) => !p.includes('\0') && !p.replace(/\\/g, '/').includes('/../'),
    'Invalid file path',
  ),
  reason: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Param schemas
// ---------------------------------------------------------------------------

/** Validates :action param for DAG task actions */
export const dagActionParamsSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  action: z.enum(['start', 'complete', 'fail', 'pause', 'resume', 'retry', 'skip', 'cancel']),
});

/** Validates :action param for decision confirm/reject */
export const decisionActionParamsSchema = z.object({
  id: z.string(),
  action: z.enum(['confirm', 'reject']),
});
