import { z } from 'zod'

export const MemberCreateSchema = z.object({
  name: z.string().min(2).max(100).trim(),
  phone: z.string().min(10).max(15).regex(/^[0-9+\-\s]+$/, 'Invalid phone number'),
  planId: z.string().min(1).max(50),
  paymentMethod: z.enum(['cash', 'upi', 'razorpay_online', 'card', 'online']),
  transactionId: z.string().max(100).optional(),
  photo: z.string().optional(),
  planQuantity: z.number().int().min(1).max(100).optional().default(1),
  paidAmount: z.number().min(0).max(10_00_000).optional().default(0),    // Max ₹10L
  balanceAmount: z.number().min(0).max(10_00_000).optional().default(0),
})

export const EntertainmentMemberCreateSchema = z.object({
  name: z.string().min(2).max(100).trim(),
  phone: z.string().min(10).max(15).regex(/^[0-9+\-\s]+$/, 'Invalid phone number'),
  planId: z.string().min(1).max(50),
  dob: z.string().optional(),
  photoBase64: z.string().optional(),
  aadharCard: z.string().max(20).optional(),
  address: z.string().max(300).optional(),
  planQuantity: z.number().int().min(1).max(100).optional().default(1),
  paidAmount: z.number().min(0).max(10_00_000).optional().default(0),
  balanceAmount: z.number().min(0).max(10_00_000).optional().default(0),
})

export const PaymentSchema = z.object({
  memberId: z.string().min(1).max(50),
  planId: z.string().min(1).max(50),
  memberCollection: z.enum(['members', 'entertainment_members']).optional().default('members'),
  amount: z.number().positive().max(10_00_000),  // Max ₹10L per payment
  paymentMethod: z.enum(['cash', 'upi', 'razorpay_online', 'card', 'online']),
  transactionId: z.string().max(100).optional(),
  idempotencyKey: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
})

export const PlanSchema = z.object({
  name: z.string().min(2).max(50).trim(),
  durationDays: z.number().int().min(0).max(3650).optional().default(0),
  durationHours: z.number().int().min(0).max(1000).optional().default(0),
  durationMinutes: z.number().int().min(0).max(1000).optional().default(0),
  durationSeconds: z.number().int().min(0).max(1000).optional().default(0),
  price: z.number().min(0).max(10_00_000),       // Max ₹10L
  description: z.string().max(200).optional(),
  features: z.array(z.string().max(100)).max(20).optional().default([]),
  whatsAppAlert: z.boolean().optional(),
  allowQuantity: z.boolean().optional(),
  hasEntertainment: z.boolean().optional(),
  hasFaceScan: z.boolean().optional(),
  quickDelete: z.boolean().optional(),
  hasTokenPrint: z.boolean().optional(),
  voiceAlert: z.boolean().optional(),
  maxEntriesPerQR: z.number().int().min(1).max(1000).optional().default(1),
})

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().max(100).optional().default(''),
  status: z.enum(['active', 'expired', 'all']).optional().default('all'),
})

export const ScanSchema = z.object({
  poolId: z.string().min(1).max(50),
  scanToken: z.string().min(1).max(200),
  type: z.enum(['entry', 'exit']),
  method: z.enum(['qr', 'face', 'manual']).optional().default('qr'),
})

export const RazorpayOrderSchema = z.object({
  planId: z.string().min(1).max(50),
  cartQuantity: z.number().int().min(1).max(100).optional().default(1),
})
