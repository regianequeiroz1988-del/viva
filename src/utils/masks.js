// Máscaras de formatação de campos (CPF, telefone, CEP, etc.)
export const onlyDigits = (v) => String(v || '').replace(/\D/g, '')

export const maskCpf = (v) =>
  onlyDigits(v)
    .slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')

export const maskCnpj = (v) =>
  onlyDigits(v)
    .slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')

// CPF ou CNPJ conforme a quantidade de dígitos
export const maskCpfCnpj = (v) =>
  onlyDigits(v).length > 11 ? maskCnpj(v) : maskCpf(v)

// (00) 00000-0000  (celular)  ou  (00) 0000-0000 (fixo)
export const maskTelefone = (v) => {
  const d = onlyDigits(v).slice(0, 11)
  if (d.length <= 10) {
    return d
      .replace(/(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{4})(\d{1,4})$/, '$1-$2')
  }
  return d
    .replace(/(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d{1,4})$/, '$1-$2')
}

export const maskCep = (v) =>
  onlyDigits(v)
    .slice(0, 8)
    .replace(/(\d{5})(\d{1,3})$/, '$1-$2')

// Validações
export const cpfComprimento = (v) => onlyDigits(v).length === 11

// Validação REAL de CPF (dígitos verificadores). Rejeita tamanho errado, sequências
// repetidas (000…, 111…) e CPFs com dígito verificador incorreto.
export const cpfValido = (v) => {
  const c = onlyDigits(v)
  if (c.length !== 11) return false
  if (/^(\d)\1{10}$/.test(c)) return false // 000.000.000-00, 111.111.111-11, etc.
  let soma = 0
  for (let i = 0; i < 9; i++) soma += Number(c[i]) * (10 - i)
  let d1 = (soma * 10) % 11
  if (d1 === 10) d1 = 0
  if (d1 !== Number(c[9])) return false
  soma = 0
  for (let i = 0; i < 10; i++) soma += Number(c[i]) * (11 - i)
  let d2 = (soma * 10) % 11
  if (d2 === 10) d2 = 0
  return d2 === Number(c[10])
}

export const telefoneValido = (v) => onlyDigits(v).length >= 10
