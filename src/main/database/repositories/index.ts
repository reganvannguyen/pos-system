import type { PosDatabase } from '../types'
import { createProductRepository } from './products'
import { createSalesRepository } from './sales'
import { createSettingsRepository } from './settings'
import { createTaxRepository } from './taxes'

export function createRepositories(database: PosDatabase) {
  const taxes = createTaxRepository(database)
  return {
    products: createProductRepository(database),
    sales: createSalesRepository(database, taxes),
    settings: createSettingsRepository(database),
    taxes
  }
}
