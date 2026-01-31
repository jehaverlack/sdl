# node-web-app
Node.js Web Application

# Purpose

This web application template provides a modular template for building a node.js web application with an API and UI.

## Directory Structure

```
node-web-app
├── app
│   └── modules
│       ├── template
│       └── web
├── conf
│   ├── modules
│   └── secrets
├── data
│   └── sqlite3
├── docs
├── html
│   ├── conf
│   ├── css
│   ├── img
│   ├── js
│   └── md
└── logs
```



# Getting Started

## Pre-requisites
- [Node.js](https://nodejs.org/en) 22.x

### Optional for Development
- [DB Browser for SQLite](https://sqlitebrowser.org/]
- To view data in **data/sqlite/nwa.db**

## Clone Repo

```
git clone 
```

## Install Dependencies

```
cd node-web-app/app
```

```
npm install
```

## Starting the application

Ensure you are in the `node-web-app/app` directory

```
npm start
```

```
$ node-web-app/app$ npm start

> node-web-app@1.0.0 start
> node index.js

web: INFO: WebUI running on 127.0.0.1:8080
