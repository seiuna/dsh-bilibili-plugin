/**
 * 命令参数校验器
 */

import type { ValidatorFn } from './types.js';

export type { ValidatorFn };

/**
 * 常用内置校验器
 */
export const Validators = {
  /**
   * 纯数字校验
   */
  numeric: (value: string): true | string => {
    return /^\d+$/.test(value) ? true : '错误: 必须是有效的纯数字格式';
  },

  /**
   * 非空校验
   */
  nonEmpty: (value: string): true | string => {
    return value.trim().length > 0 ? true : '错误: 不能为空';
  },

  /**
   * 邮箱格式校验
   */
  email: (value: string): true | string => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value) ? true : '错误: 邮箱格式不正确';
  },

  /**
   * URL 格式校验
   */
  url: (value: string): true | string => {
    try {
      new URL(value);
      return true;
    } catch {
      return '错误: URL 格式不正确';
    }
  },

  /**
   * UUID 格式校验
   */
  uuid: (value: string): true | string => {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(value) ? true : '错误: UUID 格式不正确';
  },

  /**
   * QQ 号码校验
   */
  qq: (value: string): true | string => {
    return /^\d{5,11}$/.test(value)
      ? true
      : '错误: QQ 号码格式不正确 (应为 5-11 位数字)';
  },

  /**
   * 手机号码校验
   */
  phone: (value: string): true | string => {
    return /^1[3-9]\d{9}$/.test(value)
      ? true
      : '错误: 手机号码格式不正确';
  },

  /**
   * IP 地址校验
   */
  ipAddress: (value: string): true | string => {
    const ipRegex =
      /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return ipRegex.test(value) ? true : '错误: IP 地址格式不正确';
  },

  /**
   * 中文校验
   */
  chinese: (value: string): true | string => {
    return /[\u4e00-\u9fa5]/.test(value)
      ? true
      : '错误: 必须包含中文字符';
  },

  /**
   * 英文校验
   */
  english: (value: string): true | string => {
    return /^[a-zA-Z]+$/.test(value)
      ? true
      : '错误: 必须是英文字母';
  },

  /**
   * 字母数字混合校验
   */
  alphanumeric: (value: string): true | string => {
    return /^[a-zA-Z0-9]+$/.test(value)
      ? true
      : '错误: 只能包含字母和数字';
  },

  /**
   * 最小长度限制校验器
   */
  minLength: (min: number): ValidatorFn => (value: string) => {
    return value.length >= min
      ? true
      : `错误: 长度至少为 ${min} 个字符`;
  },

  /**
   * 最大长度限制校验器
   */
  maxLength: (max: number): ValidatorFn => (value: string) => {
    return value.length <= max
      ? true
      : `错误: 长度不能超过 ${max} 个字符`;
  },

  /**
   * 长度范围校验器
   */
  lengthRange: (min: number, max: number): ValidatorFn => (value: string) => {
    if (value.length < min || value.length > max) {
      return `错误: 长度必须在 ${min} 到 ${max} 个字符之间`;
    }
    return true;
  },

  /**
   * 枚举选项校验器
   */
  choice: (choices: string[]): ValidatorFn => (value: string) => {
    return choices.includes(value)
      ? true
      : `错误: 必须是以下选项之一: ${choices.join(', ')}`;
  },

  /**
   * 正则表达式匹配校验器
   */
  pattern: (regex: RegExp, message: string = '格式不正确'): ValidatorFn => (
    value: string,
  ) => {
    // Validators are reusable; /g and /y lastIndex must not make repeated calls alternate.
    const previousIndex = regex.lastIndex;
    regex.lastIndex = 0;
    const valid = regex.test(value);
    regex.lastIndex = previousIndex;
    return valid ? true : `错误: ${message}`;
  },

  /**
   * 自定义函数校验器
   */
  custom: (
    fn: (value: string) => boolean,
    message: string = '数据校验失败',
  ): ValidatorFn => (value: string) => {
    return fn(value) ? true : `错误: ${message}`;
  },

  /**
   * 组合校验 (全通过)
   */
  all: (...validators: ValidatorFn[]): ValidatorFn => (value: string) => {
    for (const validator of validators) {
      const result = validator(value);
      if (result !== true) {
        return result;
      }
    }
    return true;
  },

  /**
   * 组合校验 (任意通过)
   */
  any: (...validators: ValidatorFn[]): ValidatorFn => (value: string) => {
    const errors: string[] = [];
    for (const validator of validators) {
      const result = validator(value);
      if (result === true) {
        return true;
      }
      errors.push(result);
    }
    return `错误: ${errors.join(' 或 ')}`;
  },

  /**
   * 数值范围校验
   */
  numberRange: (min: number, max: number): ValidatorFn => (
    value: string,
  ) => {
    const num = value.trim() ? Number(value) : NaN;
    if (!Number.isFinite(num)) {
      return '错误: 必须是有效的数字';
    }
    if (num < min || num > max) {
      return `错误: 必须在 ${min} 到 ${max} 之间`;
    }
    return true;
  },

  /**
   * 最小值限制校验
   */
  minimum: (min: number): ValidatorFn => (value: string) => {
    const num = value.trim() ? Number(value) : NaN;
    if (!Number.isFinite(num)) {
      return '错误: 必须是有效的数字';
    }
    return num >= min ? true : `错误: 不能小于 ${min}`;
  },

  /**
   * 最大值限制校验
   */
  maximum: (max: number): ValidatorFn => (value: string) => {
    const num = value.trim() ? Number(value) : NaN;
    if (!Number.isFinite(num)) {
      return '错误: 必须是有效的数字';
    }
    return num <= max ? true : `错误: 不能大于 ${max}`;
  },

  /**
   * 时间戳格式校验
   */
  timestamp: (): ValidatorFn => (value: string) => {
    const num = /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(num)) {
      return '错误: 必须是有效的时间戳数字';
    }
    if (num < 0 || num > 9999999999999) {
      return '错误: 时间戳超出了有效范围';
    }
    return true;
  },

  /**
   * ISO 日期格式校验
   */
  isoDate: (): ValidatorFn => (value: string) => {
    const datePart = value.slice(0, 10);
    const date = new Date(value);
    const day = new Date(`${datePart}T00:00:00.000Z`);
    return /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value) &&
      Number.isFinite(date.getTime()) && Number.isFinite(day.getTime()) &&
      day.toISOString().slice(0, 10) === datePart
      ? true : '错误: 必须是有效的 ISO 日期格式 (YYYY-MM-DD)';
  },

  /**
   * 文件名合法性校验
   */
  filename: (): ValidatorFn => (value: string) => {
    const invalidChars = /[<>:"|?*\\/]/;
    return !invalidChars.test(value)
      ? true
      : '错误: 文件名包含非法字符';
  },

  /**
   * 路径格式校验
   */
  path: (): ValidatorFn => (value: string) => {
    try {
      return value.length > 0 ? true : '错误: 路径不能为空';
    } catch {
      return '错误: 路径格式不正确';
    }
  },
};

/**
 * 校验链式调用器
 */
export class ChainValidator {
  private validators: ValidatorFn[] = [];

  /**
   * 添加校验器
   */
  add(validator: ValidatorFn): this {
    this.validators.push(validator);
    return this;
  }

  /**
   * 必填项要求
   */
  required(): this {
    return this.add(Validators.nonEmpty);
  }

  /**
   * 必须为数字
   */
  numeric(): this {
    return this.add(Validators.numeric);
  }

  /**
   * 长度范围限制
   */
  length(min: number, max?: number): this {
    if (max === undefined) {
      return this.add(Validators.minLength(min));
    }
    return this.add(Validators.lengthRange(min, max));
  }

  /**
   * 限定选项列表
   */
  choices(...choices: string[]): this {
    return this.add(Validators.choice(choices));
  }

  /**
   * 自定义校验函数
   */
  custom(
    fn: (value: string) => boolean,
    message?: string,
  ): this {
    return this.add(Validators.custom(fn, message));
  }

  /**
   * 执行校验
   */
  validate(value: string): true | string {
    for (const validator of this.validators) {
      const result = validator(value);
      if (result !== true) {
        return result;
      }
    }
    return true;
  }

  /**
   * 构建校验器函数
   */
  build(): ValidatorFn {
    return (value: string) => this.validate(value);
  }
}

/**
 * 创建校验链的快捷函数
 */
export function chain(): ChainValidator {
  return new ChainValidator();
}
