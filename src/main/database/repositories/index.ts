import type { PosDatabase } from '../types'
import { createProductRepository } from './products'
import { createSalesRepository } from './sales'
import { createSettingsRepository } from './settings'

export function createRepositories(database: PosDatabase) {
  return {
    products: createProductRepository(database),
    sales: createSalesRepository(database),
    settings: createSettingsRepository(database)
  }
}
