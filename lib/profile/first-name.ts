// lib/profile/first-name.ts — Shared Unicode-aware validation for the student's real first name.
import { z } from 'zod'

export const FIRST_NAME_MAX_LENGTH = 80
export const FIRST_NAME_ERROR = 'Enter your first name (up to 80 characters).'
export const firstNameSchema = z.string().trim().refine(
  value => Array.from(value).length > 0 && Array.from(value).length <= FIRST_NAME_MAX_LENGTH,
  FIRST_NAME_ERROR,
)
