/*
 * Copyright (c) 2023, Terwer . All rights reserved.
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

import { BaseBlogApi } from "~/src/adaptors/api/base/baseBlogApi.ts"
import { createAppLogger } from "~/src/utils/appLogger.ts"
import { Attachment, MediaObject, Post, UserBlog, YamlConvertAdaptor, YamlFormatObj } from "zhi-blog-api"
import { CommonGithubClient, GithubConfig } from "zhi-github-middleware"
import { CommonGithubConfig } from "~/src/adaptors/api/base/github/commonGithubConfig.ts"
import { StrUtil, YamlUtil } from "zhi-common"
import { toRaw } from "vue"
import { Base64 } from "js-base64"
import sypIdUtil from "~/src/utils/sypIdUtil.ts"
import { ElMessage } from "element-plus"

/**
 * Github API 适配器
 *
 * @author terwer
 * @version 0.9.0
 * @since 0.9.0
 */
class CommonGithubApiAdaptor extends BaseBlogApi {
  private githubClient: CommonGithubClient

  constructor(appInstance: any, cfg: CommonGithubConfig) {
    super(appInstance, cfg)
    this.logger = createAppLogger("common-github-api-adaptor")

    const githubConfig = new GithubConfig(cfg.username, cfg.githubRepo, cfg.password)
    githubConfig.defaultBranch = cfg.githubBranch
    githubConfig.defaultPath = cfg.defaultPath
    githubConfig.defaultMsg = cfg.defaultMsg
    githubConfig.author = cfg.author
    githubConfig.email = cfg.email
    githubConfig.previewMdUrl = cfg.previewUrl
    githubConfig.previewUrl = cfg.previewPostUrl
    githubConfig.baseUrl = cfg.home
    githubConfig.mdFilenameRule = cfg.mdFilenameRule

    this.githubClient = new CommonGithubClient(githubConfig)
  }

  public async checkAuth(): Promise<boolean> {
    let flag: boolean
    try {
      const testFilePath = `test.md`
      await this.safeDeletePost(testFilePath)
      const res = await this.githubClient.publishGithubPage(testFilePath, "Hello, World!")
      await this.safeDeletePost(testFilePath)
      flag = !StrUtil.isEmptyString(res?.content?.path)
    } catch (e) {
      this.logger.info(`checkAuth error =>`, e)
      flag = false
    }

    this.logger.info(`checkAuth finished => ${flag}`)
    return flag
  }

  public async getUsersBlogs(): Promise<UserBlog[]> {
    const result: UserBlog[] = []

    const nodes = await this.githubClient.getGithubPageTreeNode("")
    this.logger.debug("getGithubPageTreeNode =>", nodes)

    // 数据适配
    if (nodes && nodes.length > 0) {
      const userblog: UserBlog = new UserBlog()
      const cfg = this.cfg as CommonGithubConfig
      userblog.blogid = cfg.defaultPath
      userblog.blogName = cfg.defaultPath
      userblog.url = StrUtil.pathJoin(StrUtil.pathJoin(cfg.home, cfg.username), cfg.githubRepo)
      result.push(userblog)
    }
    this.logger.debug("result result =>", result)

    return result
  }

  public async newPost(post: Post, publish?: boolean): Promise<string> {
    this.logger.debug("start newPost =>", { post: toRaw(post) })
    const cfg = this.cfg as CommonGithubConfig

    // 路径处理
    const savePath = post.cate_slugs?.[0] ?? cfg.blogid
    const filename = post.mdFilename ?? "auto-" + sypIdUtil.newID() + ".md"
    let docPath = StrUtil.pathJoin(savePath, filename)
    if (docPath.startsWith("/")) {
      docPath = docPath.substring(1)
    }
    if (docPath.startsWith("./")) {
      docPath = docPath.substring(2)
    }
    this.logger.info("Github文章将要最终发送到以下目录 =>", docPath)

    // 开始发布
    let finalRes: any
    try {
      const res = await this.githubClient.publishGithubPage(docPath, post.description)

      if (!res?.content?.path) {
        throw new Error("Github 调用API异常")
      }

      finalRes = res
    } catch (e) {
      // 失败之后尝试删除旧数据再发一次
      try {
        await this.deletePost(docPath)
      } catch (e) {
        this.logger.warn("尝试删除失败，忽略", e)
      }
      const res2 = await this.githubClient.publishGithubPage(docPath, post.description)
      if (!res2?.content?.path) {
        throw new Error("重发依旧失败，Github 调用API异常")
      }

      finalRes = res2
    }

    return finalRes.content.path
  }

  public async getPost(postid: string, useSlug?: boolean): Promise<Post> {
    this.logger.debug("start getPost =>", { postid: postid })

    const res = await this.githubClient.getGithubPage(postid)
    this.logger.debug("getPost finished =>", res)
    if (!res) {
      throw new Error("Github 调用API异常")
    }

    let commonPost = new Post()
    commonPost.postid = res.path
    commonPost.mdFilename = res.name
    commonPost.markdown = Base64.fromBase64(res.content)
    commonPost.description = commonPost.markdown

    // YAML属性转换
    const yamlAdaptor: YamlConvertAdaptor = this.getYamlAdaptor()
    if (null !== yamlAdaptor) {
      const yamlObj = await YamlUtil.yaml2ObjAsync(commonPost.description)
      const yamlFormatObj = new YamlFormatObj()
      yamlFormatObj.yamlObj = yamlObj
      this.logger.debug("extract frontFormatter, yamlFormatObj =>", yamlFormatObj)
      commonPost = yamlAdaptor.convertToAttr(commonPost, yamlFormatObj, this.cfg)
      this.logger.debug("handled yamlObj using YamlConverterAdaptor =>", yamlObj)
    }

    // 初始化知识空间
    const catSlugs = []
    const extractedPath = res.path.replace(res.name, "").replace(/\/$/, "")
    catSlugs.push(extractedPath)
    commonPost.cate_slugs = catSlugs

    return commonPost
  }

  public async editPost(postid: string, post: Post, publish?: boolean): Promise<boolean> {
    this.logger.debug("start editPost =>", { postid: postid, post: toRaw(post) })

    // 检查是否需要更改目录
    const originalPath = postid
    const originalDir = originalPath.substring(0, originalPath.lastIndexOf("/"))
    const filename = originalPath.substring(originalPath.lastIndexOf("/") + 1)

    // 获取新的目录路径
    const newDir = post.cate_slugs?.[0] ?? originalDir
    let newPath = StrUtil.pathJoin(newDir, filename)
    if (newPath.startsWith("/")) {
      newPath = newPath.substring(1)
    }

    // 如果目录发生变化，先删除原文件，再在新目录创建
    if (originalDir !== newDir) {
      this.logger.info(`目录已更改，从 ${originalDir} 移动到 ${newDir}`)
      try {
        // 删除原文件
        await this.githubClient.deleteGithubPage(originalPath)
        // 在新目录创建文件
        const res = await this.githubClient.publishGithubPage(newPath, post.description)
        if (!res?.content?.path) {
          throw new Error("Github 调用API异常，无法在新目录创建文件")
        }
        // 更新post的postid为新路径
        post.postid = newPath
        ElMessage.success(`目录已成功从 ${originalDir} 移动到 ${newDir}`)
        return true
      } catch (e) {
        this.logger.error("移动文件失败", e)
        throw e
      }
    } else {
      // 目录未变更，正常更新
      const res = await this.githubClient.updateGithubPage(post.postid, post.description)
      if (!res?.content?.path) {
        throw new Error("Github 调用API异常")
      }
      return true
    }
  }

  public async deletePost(postid: string): Promise<boolean> {
    const res = await this.githubClient.deleteGithubPage(postid)
    if (!res?.commit?.sha) {
      throw new Error("Github 调用API异常")
    }
    return true
  }

  public async getCategoryTreeNodes(docPath: string): Promise<any[]> {
    const res = await this.githubClient.getGithubPageTreeNode(docPath)
    return res
  }

  public async getPreviewUrl(postid: string): Promise<string> {
    const cfg = this.cfg as CommonGithubConfig
    let previewUrl: string
    previewUrl = cfg.previewUrl
      .replace("[user]", cfg.username)
      .replace("[repo]", cfg.githubRepo)
      .replace("[branch]", cfg.githubBranch)
      .replace("[docpath]", postid)
    // 路径组合
    // previewUrl = StrUtil.pathJoin(this.cfg.home, previewUrl)
    return previewUrl
  }

  public override async getPostPreviewUrl(postid: string): Promise<string> {
    let previewUrl: string
    const newPostid = postid.substring(postid.lastIndexOf("/") + 1).replace(".md", "")
    previewUrl = this.cfg.previewPostUrl.replace("[postid]", newPostid)
    // 路径组合
    // previewUrl = StrUtil.pathJoin(this.cfg.postHome, previewUrl)

    return previewUrl
  }

  public async newMediaObject(mediaObject: MediaObject): Promise<Attachment> {
    try {
      const bits = mediaObject.bits
      const base64 = Base64.fromUint8Array(bits)
      const imageSavePath = this.getImagePath(this.cfg.imageStorePath, mediaObject, "source/images").imagePath
      const imageLinkPath = this.getImagePath(this.cfg.imageLinkPath, mediaObject, "images").absImgPath
      this.logger.info("Github 图片将要最终发送到以下目录 =>", imageSavePath)
      this.logger.info("图片可以使用下列链接访问", imageLinkPath)
      try {
        const res = await this.githubClient.publishGithubPage(imageSavePath, base64, "base64")
        this.logger.debug("github publishGithubPage res =>", res)
      } catch (e) {
        this.logger.error("github publishGithubPage error =>", e)
        // 422 代表图片已存在
        if (e.status === 422) {
          this.logger.warn("image already exists", e)
        } else {
          throw e
        }
      }

      const siteImgId = mediaObject.name
      const siteImgUrl = imageLinkPath
      const siteArticleId = mediaObject.name
      // // https://raw.githubusercontent.com/terwer/hexo-blog/test/images/image-20240401103158-bnwme8a.png
      // let toImagePath = StrUtil.pathJoin("https://raw.githubusercontent.com", this.cfg.username)
      // toImagePath = StrUtil.pathJoin(toImagePath, cfg.githubRepo)
      // toImagePath = StrUtil.pathJoin(toImagePath, cfg.githubBranch)
      // toImagePath = StrUtil.pathJoin(toImagePath, encodeURI(savePath))
      // toImagePath = StrUtil.pathJoin(toImagePath, encodeURIComponent(mediaObject.name))
      // siteImgUrl = toImagePath
      this.logger.info("Github 图片上传成功")

      return {
        attachment_id: siteImgId,
        date_created_gmt: new Date(),
        parent: 0,
        link: siteImgUrl,
        title: mediaObject.name,
        caption: "",
        description: "",
        metadata: {
          width: 0,
          height: 0,
          file: "",
          filesize: 0,
          sizes: [],
        },
        type: mediaObject.type,
        thumbnail: "",
        id: siteArticleId,
        file: mediaObject.name,
        url: siteImgUrl,
      }
    } catch (e) {
      this.logger.error("Error uploading image to github:", e)
      throw e
    }
  }

  // ================
  // private methods
  // ================
  private getImagePath(path: string, mediaObject: MediaObject, defaultPath: string, removeStart = true) {
    let imagePath: string
    let absImgPath: string
    if (path.startsWith("[docpath]")) {
      const post = mediaObject.post
      const docPath = post.cate_slugs?.[0] ?? this.cfg.blogid
      const savePath = StrUtil.pathJoin(docPath, path.replace("[docpath]", ""))
      imagePath = StrUtil.pathJoin(savePath, mediaObject.name)
    } else if (path.startsWith("./")) {
      return {
        imagePath: path,
        absImgPath: path,
      }
    } else {
      const savePath = StrUtil.isEmptyString(path) ? defaultPath : path
      imagePath = StrUtil.pathJoin(savePath, mediaObject.name)
    }
    // 处理相对路径
    if (imagePath.startsWith("/")) {
      imagePath = imagePath.substring(1)
    }
    absImgPath = StrUtil.pathJoin("/", imagePath)
    return {
      imagePath,
      absImgPath,
    }
  }

  public async safeDeletePost(postid: string): Promise<boolean> {
    try {
      await this.githubClient.deleteGithubPage(postid)
    } catch (e) {}

    return true
  }
}

export { CommonGithubApiAdaptor }
