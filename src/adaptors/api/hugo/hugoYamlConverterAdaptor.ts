/*
 * Copyright (c) 2022-2023, Terwer . All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * This code is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2 only, as
 * published by the Free Software Foundation.  Terwer designates this
 * particular file as subject to the "Classpath" exception as provided
 * by Terwer in the LICENSE file that accompanied this code.
 *
 * This code is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License
 * version 2 for more details (a copy is included in the LICENSE file that
 * accompanied this code).
 *
 * You should have received a copy of the GNU General Public License version
 * 2 along with this work; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin St, Fifth Floor, Boston, MA 02110-1301 USA.
 *
 * Please contact Terwer, Shenzhen, Guangdong, China, youweics@163.com
 * or visit www.terwer.space if you need additional information or have any
 * questions.
 */

import { createAppLogger } from "~/src/utils/appLogger.ts"
import { BlogConfig, Post, YamlConvertAdaptor, YamlFormatObj } from "zhi-blog-api"
import { DateUtil, JsonUtil, ObjectUtil, StrUtil, YamlUtil } from "zhi-common"
import { toRaw } from "vue"

/**
 * Hugo平台的YAML解析器
 *
 * @see {https://gohugo.io/content-management/front-matter/ front-tmatter}
 * @author terwer
 * @since 0.8.1
 */
class HugoYamlConverterAdaptor extends YamlConvertAdaptor {
  private readonly logger = createAppLogger("hugo-yaml-converter-adaptor")

  public convertToYaml(post: Post, yamlFormatObj?: YamlFormatObj, cfg?: BlogConfig): YamlFormatObj {
    this.logger.debug("您正在使用 Hugo Yaml Converter", { post: toRaw(post) })
    // 没有的情况默认初始化一个
    if (!yamlFormatObj) {
      yamlFormatObj = new YamlFormatObj()
      // title
      yamlFormatObj.yamlObj.title = post.title

      // slug
      yamlFormatObj.yamlObj.slug = post.wp_slug

      // url
      if (cfg.yamlLinkEnabled) {
        yamlFormatObj.yamlObj.url = "/post/" + post.wp_slug + ".html"
      }

      // date
      let tzstr = "+00:00"
      const tz = new Date().getTimezoneOffset() / -60
      const sign = tz > 0 ? "+" : "-"
      if (tz.toString().length < 2) {
        tzstr = `${sign}0${tz}:00`
      } else {
        tzstr = `${sign}${tz}:00`
      }
      yamlFormatObj.yamlObj.date = DateUtil.formatIsoToZh(post.dateCreated.toISOString(), true) + tzstr

      // lastmod
      if (!post.dateUpdated) {
        post.dateUpdated = new Date()
      }
      yamlFormatObj.yamlObj.lastmod = DateUtil.formatIsoToZh(post.dateUpdated.toISOString(), true) + tzstr

      // tags
      if (!StrUtil.isEmptyString(post.mt_keywords)) {
        const tags = post.mt_keywords.split(",")
        yamlFormatObj.yamlObj.tags = tags
      }

      // categories
      if (post.categories?.length > 0) {
        yamlFormatObj.yamlObj.categories = post.categories
      }

      // seo
      if (!StrUtil.isEmptyString(post.mt_keywords)) {
        yamlFormatObj.yamlObj.keywords = post.mt_keywords
      }
      if (!StrUtil.isEmptyString(post.shortDesc)) {
        yamlFormatObj.yamlObj.description = post.shortDesc
      }

      // // linkTitle
      // const linkTitle = post.linkTitle
      // // weight
      // const weight = parseInt(post.weight.toString())
      // if (weight > 0) {
      //   yamlFormatObj.yamlObj.weight = weight
      // }
      // if (!StrUtil.isEmptyString(linkTitle)) {
      //   yamlFormatObj.yamlObj.linkTitle = linkTitle
      //   if (weight > 0) {
      //     yamlFormatObj.yamlObj.menu = {
      //       main: {
      //         weight: weight,
      //       },
      //     }
      //   }
      // }

      // 上面是固定配置。下面是个性配置
      const dynYamlCfg = JsonUtil.safeParse<any>(cfg?.dynYamlCfg ?? "{}", {})
      if (ObjectUtil.isEmptyObject(dynYamlCfg)) {
        // toc
        yamlFormatObj.yamlObj.toc = true

        // isCJKLanguage
        yamlFormatObj.yamlObj.isCJKLanguage = true
      } else {
        Object.keys(dynYamlCfg).forEach((key) => {
          yamlFormatObj.yamlObj[key] = dynYamlCfg[key]
        })
      }
    } else {
      this.logger.info("yaml 已保存，不使用预设", { post: toRaw(post) })
    }

    // formatter
    let yaml = YamlUtil.obj2Yaml(yamlFormatObj.yamlObj)
    this.logger.debug("yaml=>", yaml)

    yamlFormatObj.formatter = yaml
    yamlFormatObj.mdContent = post.markdown
    yamlFormatObj.mdFullContent = YamlUtil.addYamlToMd(yamlFormatObj.formatter, yamlFormatObj.mdContent)
    yamlFormatObj.htmlContent = post.html
    this.logger.info("生成默认的YAML")

    return yamlFormatObj
  }

  public convertToAttr(post: Post, yamlFormatObj: YamlFormatObj, cfg?: BlogConfig): Post {
    this.logger.debug("开始转换YAML到Post", yamlFormatObj)

    // 标题
    if (yamlFormatObj.yamlObj?.title) {
      post.title = yamlFormatObj.yamlObj?.title
    }

    // 发布时间
    if (yamlFormatObj.yamlObj?.date) {
      post.dateCreated = DateUtil.convertStringToDate(yamlFormatObj.yamlObj?.date)
    }
    if (yamlFormatObj.yamlObj?.lastmod) {
      post.dateUpdated = DateUtil.convertStringToDate(yamlFormatObj.yamlObj?.lastmod)
    }

    // 摘要
    post.shortDesc = yamlFormatObj.yamlObj?.description

    // 标签
    post.mt_keywords = yamlFormatObj.yamlObj?.tags?.join(",")

    // 分类
    post.categories = yamlFormatObj.yamlObj?.categories

    // 添加新的YAML
    post.yaml = YamlUtil.obj2Yaml(yamlFormatObj.yamlObj)

    this.logger.debug("转换完成，post =>", post)
    return post
  }
}

export { HugoYamlConverterAdaptor }
