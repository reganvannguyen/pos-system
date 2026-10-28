import type { Customer, CustomerApiError, CustomerField, CustomerResult } from '../shared/pos-api'
import type { CustomerRecord } from './database/types'
import type { CustomerRepository, CustomerWriteData } from './database/repositories/customers'

export class CustomerServiceError extends Error {
  constructor(
    readonly code: Exclude<CustomerApiError['code'], 'internal'>,
    message: string,
    readonly field?: CustomerField
  ) {
    super(message)
    this.name = 'CustomerServiceError'
  }
}

export function createCustomerService(repository: CustomerRepository) {
  return {
    list(value: unknown): Customer[] {
      if (typeof value !== 'string' || value.length > 200) {
        throw new CustomerServiceError('invalid-input', 'Enter a valid customer search.')
      }
      const query = value.trim().toLocaleLowerCase('en-CA')
      return repository
        .list()
        .filter((customer) =>
          [
            customer.first_name,
            customer.last_name,
            customer.company_name,
            customer.address,
            customer.phone_number,
            customer.email
          ].some((field) => field.toLocaleLowerCase('en-CA').includes(query))
        )
        .map(toCustomer)
    },

    create(value: unknown): Customer {
      return toCustomer(repository.create(parseCustomerInput(value)))
    },

    update(idValue: unknown, value: unknown): Customer {
      const id = parseId(idValue)
      if (!repository.getById(id)) {
        throw new CustomerServiceError('not-found', 'This customer no longer exists.')
      }
      return toCustomer(repository.update(id, parseCustomerInput(value)))
    }
  }
}

export function toCustomerResult<T>(operation: () => T): CustomerResult<T> {
  try {
    return { ok: true, data: operation() }
  } catch (error) {
    if (error instanceof CustomerServiceError) {
      return {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.field && { field: error.field })
        }
      }
    }

    console.error('Customer operation failed.', error)
    return {
      ok: false,
      error: { code: 'internal', message: 'Unable to complete the customer operation.' }
    }
  }
}

function parseCustomerInput(value: unknown): CustomerWriteData {
  if (!isRecord(value)) {
    throw new CustomerServiceError('invalid-input', 'Enter the customer details.')
  }

  const fields: CustomerField[] = [
    'firstName',
    'lastName',
    'companyName',
    'address',
    'phoneNumber',
    'email'
  ]
  const limits: Record<CustomerField, number> = {
    firstName: 100,
    lastName: 100,
    companyName: 160,
    address: 300,
    phoneNumber: 50,
    email: 254,
    imageDataUrl: 2_800_000
  }
  const customer: CustomerWriteData = {
    firstName: '',
    lastName: '',
    companyName: '',
    address: '',
    phoneNumber: '',
    email: '',
    imageDataUrl: null
  }

  for (const field of fields) {
    const fieldValue = value[field]
    if (typeof fieldValue !== 'string') {
      throw new CustomerServiceError('invalid-input', 'Enter valid customer details.', field)
    }
    const trimmed = fieldValue.trim()
    if (trimmed.length > limits[field]) {
      throw new CustomerServiceError('invalid-input', 'This value is too long.', field)
    }
    customer[field] = trimmed
  }

  if (!customer.firstName && !customer.lastName && !customer.companyName) {
    throw new CustomerServiceError(
      'invalid-input',
      'Enter a first name, last name, or company name.',
      'firstName'
    )
  }
  if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
    throw new CustomerServiceError('invalid-input', 'Enter a valid email address.', 'email')
  }

  const imageDataUrl = value.imageDataUrl
  if (imageDataUrl === null || imageDataUrl === '') {
    customer.imageDataUrl = null
  } else if (
    typeof imageDataUrl !== 'string' ||
    imageDataUrl.length > limits.imageDataUrl ||
    !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(imageDataUrl)
  ) {
    throw new CustomerServiceError(
      'invalid-input',
      'Choose a PNG, JPEG, or WebP image under 2 MB.',
      'imageDataUrl'
    )
  } else {
    customer.imageDataUrl = imageDataUrl
  }

  return customer
}

function parseId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new CustomerServiceError('invalid-input', 'Choose a valid customer.')
  }
  return value
}

function toCustomer(value: CustomerRecord | undefined): Customer {
  if (!value) throw new Error('The customer was not available after saving.')
  return {
    id: value.id,
    firstName: value.first_name,
    lastName: value.last_name,
    companyName: value.company_name,
    address: value.address,
    phoneNumber: value.phone_number,
    email: value.email,
    imageDataUrl: value.image_data_url,
    createdAt: value.created_at,
    updatedAt: value.updated_at
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
