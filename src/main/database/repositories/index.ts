import type { PosDatabase } from '../types'
import { createProductRepository } from './products'
import { createCustomerRepository } from './customers'
import { createSalesRepository } from './sales'
import { createSettingsRepository } from './settings'
import { createTaxRepository } from './taxes'

export function createRepositories(database: PosDatabase) {
  const taxes = createTaxRepository(database)
  return {
    customers: createCustomerRepository(database),
    products: createProductRepository(database),
    sales: createSalesRepository(database, taxes),
    settings: createSettingsRepository(database),
    taxes
  }
}
